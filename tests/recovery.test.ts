import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { openDatabase, migrate } from '../server/db';
import { Jobs, PendingOperation, ReviewRequired } from '../server/jobs';
import { Chain } from '../server/chain';
import { Providers } from '../server/providers';
import { DEFAULT_CADENCE } from '../shared/game';
import type { Settings } from '../shared/types';
import { config } from '../server/config';

const settings:Settings={paused:false,dailyCapUsd:100,gasReserveSol:.05,slippageBps:100,cadence:DEFAULT_CADENCE};
test('claims, swaps, payments and transfers persist signatures before sending and reconcile after restart',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db),signer=Keypair.generate();
  try{
    for(const kind of ['fee-claim','swap','pack-payment','nft-transfer']){
      let confirmed=false,sends=0,builds=0;
      const rpc={getSignatureStatuses:async()=>({value:[confirmed?{confirmationStatus:'confirmed',err:null}:null]}),isBlockhashValid:async()=>({value:true}),sendRawTransaction:async()=>{assert.ok((await jobs.get(kind)).data.raw,'signed bytes must be durable before send');sends++;return 'unused';}};
      const create=()=>{const c=new Chain(jobs);c.require=()=>({rpc:rpc as any,signer});return c;};
      const build=async()=>{builds++;return new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:signer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1})]}).compileToV0Message());};
      await assert.rejects(create().execute(kind,kind,build,settings),PendingOperation);
      const persisted=await jobs.get(kind);assert.equal(persisted.status,'submitted');assert.ok(persisted.data.signature);
      confirmed=true;
      assert.equal(await create().execute(kind,kind,build,settings),persisted.data.signature);
      assert.equal(await create().execute(kind,kind,build,settings),persisted.data.signature);
      assert.equal(sends,1);assert.equal(builds,1);
    }
  }finally{await db.close();}
});
test('failed and expired transactions need reconciliation before a rebuild',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db),signer=Keypair.generate();
  try{
    let valid=true;
    const rpc={getSignatureStatuses:async()=>({value:[null]}),isBlockhashValid:async()=>({value:valid}),getTransaction:async()=>null};
    const chain=new Chain(jobs);chain.require=()=>({rpc:rpc as any,signer});
    await jobs.put('pending','swap','submitted',{signature:'fixture',blockhash:'fixture',raw:'fixture'});
    await assert.rejects(chain.recover('pending'),PendingOperation);
    valid=false;await chain.recover('pending');
    assert.equal((await jobs.get('pending')).status,'retryable');assert.equal((await jobs.get('pending')).data.raw,undefined);
    await jobs.put('failed','swap','failed',{},'Failed simulation');
    await assert.rejects(chain.execute('failed','swap',async()=>{throw new Error('must not rebuild');},settings),ReviewRequired);
  }finally{await db.close();}
});
test('pack recovery resumes one memo, one payment and one prize through provider interruptions',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  let generations=0,payments=0,opens=0,owned=false;
  const chain={address:Keypair.generate().publicKey.toBase58(),balance:async()=>100_000_000n,ownsNft:async()=>owned,execute:async(id:string)=>{const previous=await jobs.get(id);if(previous)return 'fixture-payment';payments++;await jobs.put(id,'pack-payment','submitted',{signature:'fixture-payment'});throw new PendingOperation('sent');}} as unknown as Chain;
  const providers=()=>{
    const p=new Providers(chain,jobs);p.machines=async()=>[{price:25}];
    p.cc=async(path,data)=>{
      if(path==='/generatePack'){generations++;assert.equal((data as any).turbo,false);return{memo:'fixture-memo',transaction:'not-executed-fixture'};}
      if(path.startsWith('/pack/status'))return{pack:{status:'confirmed',refunded:null},send:{insured_value:40}};
      if(path==='/openPack'){opens++;return opens===1?{code:'WAITING_FOR_WEBHOOK'}:{nft_address:'fixture-nft',nftWon:{content:{metadata:{name:'Fixture card',image:'https://example.invalid/card.png'}}},rarity:'Test'};}
      throw new Error('Unexpected provider request');
    };return p;
  };
  try{
    await assert.rejects(providers().purchase('fixture-round',25,settings),PendingOperation);
    await assert.rejects(providers().purchase('fixture-round',25,settings),PendingOperation);
    await assert.rejects(providers().purchase('fixture-round',25,settings),PendingOperation);
    owned=true;
    const prize=await providers().purchase('fixture-round',25,settings);
    assert.equal((await providers().purchase('fixture-round',25,settings)).id,prize.id);
    assert.equal(generations,1);assert.equal(payments,1);assert.equal(opens,2);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM ledger WHERE kind='pack'")).rows[0].n,1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM prizes')).rows[0].n,1);
  }finally{await db.close();}
});
test('stock, daily cap and insufficient funding prevent pack requests',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  const chain={balance:async()=>0n} as unknown as Chain,p=new Providers(chain,jobs);let requested=0;
  p.cc=async()=>{requested++;throw new Error('must not purchase');};
  try{
    p.machines=async()=>[];await assert.rejects(p.purchase('unavailable',25,settings),/unavailable/);
    p.machines=async()=>[{price:25}];await assert.rejects(p.purchase('over-cap',25,{...settings,dailyCapUsd:24}),/spending cap/);
    await assert.rejects(p.purchase('unfunded',25,settings),/Insufficient/);assert.equal(requested,0);
  }finally{await db.close();}
});
test('swap rejects altered intents, unavailable routes and unsafe slippage without settlement',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  const chain={address:'fixture',execute:async(_id:string,_kind:string,build:()=>unknown)=>build()} as unknown as Chain,p=new Providers(chain,jobs);
  const pair=[config.CARDS_MINT,config.USDC_MINT] as const;
  try{
    p.quote=async()=>({errorCode:1,errorMessage:'No route'});await assert.rejects(p.swap('no-route',...pair,10n,settings),/No route/);
    await assert.rejects(p.swap('no-route',...pair,11n,settings),/intent changed/);
    p.quote=async()=>({transaction:'unused',router:'metis',inputMint:pair[0],outputMint:pair[1],inAmount:'10',outAmount:'100',otherAmountThreshold:'90',slippageBps:1000});
    await assert.rejects(p.swap('slippage',...pair,10n,settings),/slippage ceiling/);
    await assert.rejects(p.swap('price-change',...pair,10n,settings,200n),/no longer funds/);
  }finally{await db.close();}
});
