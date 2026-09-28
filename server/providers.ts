import { randomUUID } from 'node:crypto';
import { PublicKey, SystemProgram, ComputeBudgetProgram, VersionedTransaction } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createRequire } from 'node:module';
const { OnlinePumpSdk, PUMP_SDK, feeSharingConfigPda, normalizeQuoteMint } = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk');
import { Chain, type TxPolicy } from './chain';
import { Jobs, PendingOperation, ReviewRequired } from './jobs';
import { config } from './config';
import type { Prize, Settings } from '../shared/types';
import { fetchMetadata } from './remote-metadata';

export async function jsonFetch(url:string,init:RequestInit={}){const response=await fetch(url,{...init,signal:AbortSignal.timeout(15_000)});const body:any=await response.json();if(!response.ok)throw new Error(body.error||body.message||`Provider returned HTTP ${response.status}`);return body;}
const CC='https://gacha.collectorcrypt.com';
const JUP='https://api.jup.ag/swap/v2';
const PACK_WALLET=config.COLLECTOR_CRYPT_PAYMENT_WALLET;
export class Providers {
  constructor(readonly chain:Chain,readonly jobs:Jobs){}
  cc(path:string,data?:unknown){return jsonFetch(`${CC}/api${path}`,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(config.COLLECTOR_CRYPT_API_KEY?{'x-api-key':config.COLLECTOR_CRYPT_API_KEY}:{})},body:data?JSON.stringify(data):undefined});}
  async machines(){const[catalog,status]=await Promise.all([this.cc('/machines'),this.cc('/status')]);if(status.machineStatus!=='running')return[];return catalog.machines.filter((m:any)=>m.public&&[25,50,100].includes(m.price)&&m.code===`pokemon_${m.price}`&&m.contains===1&&Object.values(m.stock??{}).length>0&&Object.values(m.stock??{}).every((n:any)=>Number.isFinite(n)&&n>0)&&status.gachas?.some((s:any)=>s.code===m.code&&s.isOpen));}
  quote(inputMint:string,outputMint:string,amount:bigint,taker?:string,slippageBps=100){return jsonFetch(`${JUP}/order?${new URLSearchParams({inputMint,outputMint,amount:amount.toString(),slippageBps:String(slippageBps),excludeRouters:'jupiterz,dflow,okx',...(taker?{taker}:{})})}`,{headers:{'x-api-key':config.JUPITER_API_KEY}});}
  async tokenDelta(signature:string,mint:string){const{rpc,signer}=this.chain.require();const tx=await rpc.getTransaction(signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});if(!tx||!tx.meta)throw new PendingOperation('Waiting for transaction accounting.');if(tx.meta.err)throw new ReviewRequired('Transaction failed.');
    if(mint===NATIVE_MINT.toBase58()){const index=tx.transaction.message.staticAccountKeys.findIndex(k=>k.equals(signer.publicKey));if(index<0)return 0n;return BigInt(tx.meta.postBalances[index]-tx.meta.preBalances[index]+(index===0?tx.meta.fee:0));}
    const sum=(rows:any[])=>rows.filter(a=>a.owner===this.chain.address&&a.mint===mint).reduce((s,a)=>s+BigInt(a.uiTokenAmount.amount),0n);return sum(tx.meta.postTokenBalances??[])-sum(tx.meta.preTokenBalances??[]);
  }
  async swap(id:string,inputMint:string,outputMint:string,amount:bigint,settings:Settings,minOutput=1n){
    if(amount<=0n)throw new Error('Swap amount must be positive.');
    let job=await this.jobs.get(id);if(!job)await this.jobs.put(id,'swap','queued',{inputMint,outputMint,amount:amount.toString(),minOutput:minOutput.toString()});
    job=await this.jobs.get(id);const d=job.data;
    if(d.inputMint!==inputMint||d.outputMint!==outputMint||d.amount!==amount.toString())throw new ReviewRequired('Swap intent changed during recovery.');
    const policy:TxPolicy={kind:'swap',inputMint,maxInput:amount,outputMint,minOutput};
    const signature=await this.chain.execute(id,'swap',async()=>{const requestedAt=Date.now(),order=await this.quote(inputMint,outputMint,amount,this.chain.address!,settings.slippageBps);if(Date.now()-requestedAt>10_000)throw new Error('Swap quote is stale. Retry with current pricing.');if(order.errorCode||!order.transaction)throw new Error(order.errorMessage||'No supported swap route.');if(order.router!=='metis'||order.inputMint!==inputMint||order.outputMint!==outputMint||BigInt(order.inAmount)!==amount)throw new ReviewRequired('Swap quote route, asset or amount mismatch.');const guaranteed=BigInt(order.outAmount)*(10_000n-BigInt(settings.slippageBps))/10_000n;if(guaranteed<minOutput)throw new Error('Swap no longer funds the selected pack.');if(BigInt(order.otherAmountThreshold??'0')<guaranteed||Number(order.slippageBps)>settings.slippageBps)throw new ReviewRequired('Swap exceeds the configured slippage ceiling.');policy.minOutput=guaranteed;const tx=VersionedTransaction.deserialize(Buffer.from(order.transaction,'base64'));if(tx.message.header.numRequiredSignatures!==1)throw new ReviewRequired('Swap requires an unsupported co-signer.');return tx;},settings,policy);
    const received=await this.tokenDelta(signature,outputMint);if(received<minOutput)throw new ReviewRequired('Settled swap output is insufficient.');return {signature,received};
  }
  async collectFees(settings:Settings){
    const{rpc,signer}=this.chain.require();if(config.FEE_RECIPIENT!==this.chain.address)throw new Error('The treasury signer must be the dedicated fee recipient.');
    const unfinished=(await this.jobs.db.query("SELECT * FROM jobs WHERE kind='fee-cycle' AND status<>'complete' ORDER BY created_at LIMIT 1")).rows[0];
    let cycle=unfinished;
    if(!cycle){
      const mint=new PublicKey(config.MEMECOIN_MINT),sdk=new OnlinePumpSdk(rpc),curve=await sdk.fetchBondingCurve(mint);if(curve.isHolderReward)throw new Error('This mint routes fees to holder rewards, not its creator.');
      const quote=normalizeQuoteMint(curve.quoteMint),sharing=curve.creator.equals(feeSharingConfigPda(mint));
      if(!sharing&&!curve.creator.equals(signer.publicKey))throw new Error('Configured wallet is not the mint’s creator-fee recipient.');
      if(sharing){const info=await rpc.getAccountInfo(curve.creator);if(!info)throw new Error('Fee sharing account is missing.');const shared=PUMP_SDK.decodeSharingConfig(info);if(!shared.shareholders.some(s=>s.address.equals(signer.publicKey)))throw new Error('Treasury is not a shareholder of this mint.');}
      const balances=await sdk.getCreatorVaultQuoteBalances(curve.creator),balance=balances.find(b=>b.mint.equals(quote));if(!balance||balance.total.isZero())return;
      const id=`fees:${randomUUID()}`;await this.jobs.put(id,'fee-cycle','claiming',{quoteMint:quote.toBase58(),creator:curve.creator.toBase58(),sharing,graduated:curve.complete});cycle=await this.jobs.get(id);
    }
    const d=cycle.data,quoteMint=new PublicKey(d.quoteMint),mint=new PublicKey(config.MEMECOIN_MINT),sdk=new OnlinePumpSdk(rpc);
    if(!d.claimSignature){d.claimSignature=await this.chain.execute(`${cycle.id}:claim`,'fee-claim',async()=>{const quoteTokenProgram=await sdk.fetchQuoteTokenProgram(quoteMint);const ixs=[ComputeBudgetProgram.setComputeUnitLimit({units:350_000})];if(d.sharing){const address=new PublicKey(d.creator),info=await rpc.getAccountInfo(address);if(!info)throw new Error('Sharing configuration is missing.');const shared=PUMP_SDK.decodeSharingConfig(info);if(d.graduated)ixs.push(await PUMP_SDK.transferCreatorFeesToPumpV2({payer:signer.publicKey,mint,quoteMint,quoteTokenProgram}));ixs.push(await PUMP_SDK.distributeCreatorFeesV2({mint,sharingConfig:shared,sharingConfigAddress:address,quoteMint,quoteTokenProgram,payer:signer.publicKey,shouldInitializeAta:true}));}else{if(!quoteMint.equals(NATIVE_MINT))ixs.push(createAssociatedTokenAccountIdempotentInstruction(signer.publicKey,getAssociatedTokenAddressSync(quoteMint,signer.publicKey,false,quoteTokenProgram),signer.publicKey,quoteMint,quoteTokenProgram));ixs.push(...await sdk.collectCoinCreatorFeeV2Instructions(signer.publicKey,quoteMint,quoteTokenProgram,signer.publicKey));}return this.chain.build(ixs);},settings);await this.jobs.put(cycle.id,'fee-cycle','routing',d);}
    if(!d.amount){const delta=await this.tokenDelta(d.claimSignature,d.quoteMint);d.amount=(delta>0n?delta:0n).toString();await this.jobs.put(cycle.id,'fee-cycle','routing',d);}
    if(BigInt(d.amount)===0n){await this.jobs.put(cycle.id,'fee-cycle','complete',d);return;}
    if(!d.cardsAmount){d.cardsAmount=d.quoteMint===config.CARDS_MINT?d.amount:(await this.swap(`${cycle.id}:cards`,d.quoteMint,config.CARDS_MINT,BigInt(d.amount),settings)).received.toString();await this.jobs.put(cycle.id,'fee-cycle','accounting',d);}
    const valuation=await this.quote(config.CARDS_MINT,config.USDC_MINT,BigInt(d.cardsAmount));if(!valuation.outAmount)throw new Error('Fee valuation temporarily unavailable.');
    await this.jobs.db.query("INSERT INTO ledger(id,kind,amount_micros,signature,created_at,data) VALUES($1,'fee',$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",[cycle.id,valuation.outAmount,d.claimSignature,Number(cycle.created_at),JSON.stringify({cardsAmount:d.cardsAmount})]);await this.jobs.put(cycle.id,'fee-cycle','complete',d);
  }
  async purchase(roundId:string,tier:number,settings:Settings):Promise<Prize>{
    const id=`pack:${roundId}`;let job=await this.jobs.get(id);
    if(job?.status==='complete')return job.data.prize;
    if(!job){if(!(await this.machines()).some((m:any)=>m.price===tier))throw new Error('Selected pack is temporarily unavailable.');await this.jobs.put(id,'pack','funding',{tier});job=await this.jobs.get(id);}
    const d=job.data;
    if(d.tier!==tier||![25,50,100].includes(tier))throw new ReviewRequired('Pack tier changed during recovery.');
    const paymentJob=await this.jobs.get(`${id}:payment`);
    if(!paymentJob?.data.raw&&!['submitted','confirmed'].includes(paymentJob?.status)){
      const day=new Date();day.setUTCHours(0,0,0,0);
      const spent=BigInt((await this.jobs.db.query("SELECT COALESCE(SUM(amount_micros),0)::text AS amount FROM ledger WHERE kind='pack' AND created_at>=$1",[day.getTime()])).rows[0].amount);
      if(spent+BigInt(tier)*1_000_000n>BigInt(Math.floor(settings.dailyCapUsd*1e6)))throw new ReviewRequired('Daily spending cap would be exceeded.');
    }
    if(!d.funded){const price=BigInt(tier)*1_000_000n,usdc=await this.chain.balance(config.USDC_MINT);if(usdc<price){let amount:bigint;const previous=await this.jobs.get(`${id}:usdc`);if(previous){amount=BigInt(previous.data.amount);}else{const cards=await this.chain.balance(config.CARDS_MINT);if(!cards)throw new Error('Insufficient pack funds.');const quote=await this.quote(config.CARDS_MINT,config.USDC_MINT,cards);const needed=price-usdc;amount=(cards*needed*10_000n+BigInt(quote.outAmount)*(10_000n-BigInt(settings.slippageBps))-1n)/(BigInt(quote.outAmount)*(10_000n-BigInt(settings.slippageBps)));if(amount>cards)throw new Error('Pack funds changed; waiting for fees.');}await this.swap(`${id}:usdc`,config.CARDS_MINT,config.USDC_MINT,amount,settings,price-usdc);}d.funded=true;await this.jobs.put(id,'pack','purchasing',d);}
    if(!d.memo){const order=await this.cc('/generatePack',{playerAddress:this.chain.address,packType:`pokemon_${tier}`,turbo:false});if(!order.memo||!order.transaction)throw new Error('Invalid pack purchase response.');d.memo=order.memo;d.transaction=order.transaction;await this.jobs.put(id,'pack','purchasing',d);}
    if(!d.paymentSignature){d.paymentSignature=await this.chain.execute(`${id}:payment`,'pack-payment',async()=>VersionedTransaction.deserialize(Buffer.from(d.transaction,'base64')),settings,{kind:'pack',inputMint:config.USDC_MINT,maxInput:BigInt(tier)*1_000_000n,minInput:BigInt(tier)*1_000_000n,recipient:PACK_WALLET,memo:d.memo,allowedPrograms:[TOKEN_PROGRAM_ID.toBase58(),ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),SystemProgram.programId.toBase58(),ComputeBudgetProgram.programId.toBase58(),'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr','Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo']});await this.jobs.put(id,'pack','opening',d);}
    await this.jobs.db.query("INSERT INTO ledger(id,kind,amount_micros,signature,created_at) VALUES($1,'pack',$2,$3,$4) ON CONFLICT(id) DO NOTHING",[id,tier*1_000_000,d.paymentSignature,Date.now()]);
    const status=await this.cc(`/pack/status?memo=${encodeURIComponent(d.memo)}`);if(status.pack?.refunded){await this.jobs.db.query("INSERT INTO ledger(id,kind,amount_micros,signature,created_at) VALUES($1,'refund',$2,$3,$4) ON CONFLICT(id) DO NOTHING",[`${id}:refund`,tier*1_000_000,status.pack.refund_transaction_signature,Date.now()]);throw new ReviewRequired('This pack was refunded. Owner recovery is required.');}
    if(!d.opened){const opened=await this.cc('/openPack',{memo:d.memo});if(opened.code==='WAITING_FOR_WEBHOOK'||!opened.nft_address)throw new PendingOperation('Waiting for the pack provider to confirm the payment.');if(opened.code==='TURBO_MODE_BUYBACK')throw new ReviewRequired('Unexpected automatic buyback.');d.opened=opened;await this.jobs.put(id,'pack','verifying',d);}
    if(!await this.chain.ownsNft(d.opened.nft_address))throw new PendingOperation('Waiting for the prize NFT to reach the treasury.');
    const card=d.opened.nftWon,meta=card?.content?.metadata??card?.metadata??{};let image=card?.content?.links?.image??card?.content?.files?.[0]?.uri??meta.image??card?.image;
    if(!image){const{createUmi}=await import('@metaplex-foundation/umi-bundle-defaults');const{fetchDigitalAsset}=await import('@metaplex-foundation/mpl-token-metadata');const{publicKey}=await import('@metaplex-foundation/umi');try{const asset=await fetchDigitalAsset(createUmi(config.SOLANA_RPC_URL),publicKey(d.opened.nft_address));const metadata=await fetchMetadata(asset.metadata.uri);image=metadata.image;}catch{/* Asset may be Core; provider metadata remains authoritative for display. */}}
    const insured=Number(status.send?.insured_value??meta.attributes?.find((a:any)=>/insured.?value/i.test(a.trait_type))?.value??0);
    const prize:Prize={id:randomUUID(),mint:d.opened.nft_address,name:meta.name??card?.name??'Pokémon collectible',image:typeof image==='string'&&image.startsWith('https://')?image:'/brand/grailshot-pack-v6-720.webp',value:Number.isFinite(insured)?insured:0,rarity:d.opened.rarity??'Unrated',purchaseSignature:d.paymentSignature};
    await this.jobs.db.query("INSERT INTO prizes(id,mint,data,status) VALUES($1,$2,$3,'available') ON CONFLICT(mint) DO NOTHING",[prize.id,prize.mint,JSON.stringify(prize)]);const stored=(await this.jobs.db.query('SELECT data FROM prizes WHERE mint=$1',[prize.mint])).rows[0].data;d.prize=stored;await this.jobs.put(id,'pack','complete',d);return stored;
  }
}
