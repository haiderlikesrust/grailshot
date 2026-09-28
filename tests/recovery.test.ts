import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { openDatabase, migrate } from '../server/db';
import { Jobs, PendingOperation, ReviewRequired } from '../server/jobs';
import { Chain } from '../server/chain';
import { Providers } from '../server/providers';
import { Engine } from '../server/engine';
import type { Treasury } from '../server/treasury';
import { DEFAULT_CADENCE } from '../shared/game';
import type { Settings } from '../shared/types';
import { config } from '../server/config';

const settings:Settings={paused:false,dailyCapUsd:100,gasReserveSol:.05,slippageBps:100,cadence:DEFAULT_CADENCE};

test('a landed funding swap is reconciled before purchase even when USDC is already visible',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  try{
    for(const funded of [false,true]){
      const round=`visible-swap-${funded}`,id=`pack:${round}`;let reconciles=0;
      await jobs.put(id,'pack','purchasing',{tier:25,funded});
      await jobs.put(`${id}:usdc`,'swap','submitted',{inputMint:config.CARDS_MINT,outputMint:config.USDC_MINT,amount:'500',minOutput:'25000000',signature:'already-landed-fixture'});
      const chain={address:'fixture',balance:async()=>25_250_000n} as unknown as Chain;
      const p=new Providers(chain,jobs);
      p.swap=async(swapId,input,output,amount,_settings,minOutput)=>{
        reconciles++;assert.equal(swapId,`${id}:usdc`);assert.equal(amount,500n);assert.equal(minOutput,25_000_000n);
        assert.equal(input,config.CARDS_MINT);assert.equal(output,config.USDC_MINT);
        const saved=await jobs.get(swapId);await jobs.put(swapId,'swap','confirmed',saved.data);
        return{signature:saved.data.signature,received:25_250_000n};
      };
      p.cc=async()=>{assert.equal((await jobs.get(`${id}:usdc`)).status,'confirmed');throw new Error('Fixture provider outage');};
      await assert.rejects(p.purchase(round,25,settings),/Fixture provider outage/);
      await assert.rejects(p.purchase(round,25,settings),/Fixture provider outage/);
      assert.equal(reconciles,1,'A retry does not perform a second swap');
      assert.equal((await jobs.get(id)).data.funded,true);
    }
  }finally{await db.close();}
});

test('pack validation failures are preserved for the owner while public round errors stay generic',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  try{
    const reason='Pack requests an unexpected signer or fee payer.';
    const treasury={settings,providers:{purchase:async()=>{throw new ReviewRequired(reason);}}} as unknown as Treasury;
    const engine=new Engine(db,treasury,()=>true);await engine.create(null,25);
    const r=engine.current!;r.status='purchasing';await jobs.put(`pack:${r.id}`,'pack','purchasing',{tier:25});
    await engine.step();
    assert.equal(r.status,'review');assert.equal((await jobs.get(`pack:${r.id}`)).error,reason);
    assert.equal((await db.query("SELECT data FROM audit WHERE event='pack-delay'")).rows[0].data.error,reason);
    assert.ok(!engine.view()!.message!.includes(reason));
    assert.equal(r.prize,null);
  }finally{await db.close();}
});

test('expired unsigned pack orders refresh only after checking provider activity and persist the new memo before payment',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  const wallet=Keypair.generate(),provider=Keypair.generate();
  const transaction=()=>new VersionedTransaction(new TransactionMessage({payerKey:provider.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:wallet.publicKey,toPubkey:provider.publicKey,lamports:1})]}).compileToV0Message());
  const old=transaction(),replacement=transaction();replacement.sign([provider]);
  let valid=false,status:any={pack:null,send:null},generations=0;
  const chain={address:wallet.publicKey.toBase58(),require:()=>({rpc:{isBlockhashValid:async()=>({value:valid})}})} as unknown as Chain;
  const p=new Providers(chain,jobs);
  p.cc=async(path)=>{if(path.startsWith('/pack/status'))return status;assert.equal(path,'/generatePack');generations++;return{memo:'replacement-memo',transaction:Buffer.from(replacement.serialize()).toString('base64')};};
  const original=()=>({tier:25,funded:true,memo:'old-memo',transaction:Buffer.from(old.serialize()).toString('base64')});
  try{
    const data=original();await jobs.put('pack:refresh','pack','purchasing',data);
    valid=true;assert.deepEqual((await p.packPayment('pack:refresh',data,25)).serialize(),old.serialize());assert.equal(generations,0);
    valid=false;
    assert.deepEqual((await p.packPayment('pack:refresh',data,25)).serialize(),replacement.serialize());
    assert.equal(generations,1);assert.equal((await jobs.get('pack:refresh')).data.memo,'replacement-memo');
    assert.deepEqual((await jobs.get('pack:refresh')).data.previousMemos,['old-memo']);
    for(const activity of [{pack:{status:'confirmed'},send:null},{pack:{status:null,transaction_signature:'already-paid'},send:null},{pack:null,send:{nft_address:'reserved'}},{}]){
      status=activity;await assert.rejects(p.packPayment('pack:blocked',original(),25),ReviewRequired);
    }
    assert.equal(generations,1);
    status={pack:null,send:null};await jobs.put('pack:signed:payment','pack-payment','submitted',{signature:'existing',raw:'signed'});
    await assert.rejects(p.packPayment('pack:signed',original(),25),/Reconcile the existing/);assert.equal(generations,1);
  }finally{await db.close();}
});
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

test('expired transactions automatically rebuild only after history reconciliation and a durable retry delay',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db),signer=Keypair.generate();
  let builds=0,sends=0,valid=false,landed=false;
  const rpc={getSignatureStatuses:async()=>({value:[null]}),isBlockhashValid:async()=>({value:valid}),getTransaction:async()=>landed?{meta:{err:null}}:null,sendRawTransaction:async()=>{sends++;}};
  const chain=new Chain(jobs);chain.require=()=>({rpc:rpc as any,signer});
  const build=async()=>{builds++;return new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58(),instructions:[]}).compileToV0Message());};
  try{
    await jobs.put('expired','swap','submitted',{signature:'old',blockhash:'old',raw:'old'});
    await assert.rejects(chain.execute('expired','swap',build,settings),PendingOperation);
    await assert.rejects(chain.execute('expired','swap',build,settings),PendingOperation);assert.equal(builds,0);
    await db.query('UPDATE jobs SET updated_at=0 WHERE id=$1',['expired']);
    // History can become visible after the original expiration check: do not repay.
    landed=true;assert.equal(await chain.execute('expired','swap',build,settings),'old');assert.equal(builds,0);
    landed=false;await jobs.put('retry','swap','failed',{signature:'old',blockhash:'old',raw:'old',automaticRetry:true});
    await db.query('UPDATE jobs SET updated_at=0 WHERE id=$1',['retry']);
    const oldBuild=build;const freshBuild=async()=>{const tx=await oldBuild();valid=true;return tx;};
    await assert.rejects(chain.execute('retry','swap',freshBuild,settings),PendingOperation);
    assert.equal(builds,1);assert.equal(sends,1);assert.equal((await jobs.get('retry')).data.attempts[0].signature,'old');
  }finally{await db.close();}
});

test('transient purchase errors back off automatically and a recovered prize waits for connected opponents',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);let calls=0;
  const prize={id:'recovered-prize',mint:'recovered-mint',name:'Fixture',image:'',value:31,rarity:'Test'};
  const treasury={settings,maintain:async()=>{},opened:()=>{},providers:{purchase:async()=>{calls++;if(calls===1)throw new Error('Temporary outage');return prize;}},chain:{eligibility:async()=>({eligible:true})}} as unknown as Treasury;
  try{
    await db.query("INSERT INTO prizes(id,mint,data,status) VALUES($1,$2,$3,'available')",[prize.id,prize.mint,JSON.stringify(prize)]);
    const engine=new Engine(db,treasury,()=>false);await engine.create(null,25);engine.current!.status='purchasing';
    await engine.step();assert.equal(engine.current!.status,'purchasing');assert.ok(engine.current!.retryAt!>Date.now());
    await engine.step();assert.equal(calls,1);
    // A restart resumes the same purchase and persisted backoff.
    const restarted=new Engine(db,treasury,()=>false);await restarted.init();await restarted.step();assert.equal(calls,1);
    restarted.current!.retryAt=0;await restarted.step();assert.equal(calls,2);assert.equal(restarted.current!.status,'registration');
    await restarted.step();assert.equal(restarted.current!.status,'registration');assert.equal(restarted.current!.prize!.id,prize.id);assert.equal(calls,2);
  }finally{await db.close();}
});

test('buyback quotes use provider amounts, cache concurrent requests, and distinguish unavailable from failures',async()=>{
  const p=new Providers({} as Chain,{} as Jobs);let calls=0;
  p.cc=async(path)=>{calls++;return path.includes('missing')?{available:false}:path.includes('invalid')?{available:true,amount:'wrong'}:{available:true,amount:26_350_000};};
  const [a,b]=await Promise.all([p.buybackQuote('card'),p.buybackQuote('card')]);assert.equal(calls,1);assert.equal(a.amount,26.35);assert.deepEqual(a,b);
  assert.equal((await p.buybackQuote('missing')).status,'unavailable');assert.equal((await p.buybackQuote('invalid')).status,'error');
});

test('automatic payment rebuild rechecks a newly reduced cap before requesting another order',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db);
  try{
    await jobs.put('pack:cap-rebuild','pack','purchasing',{tier:25,funded:true,memo:'original',transaction:'original'});
    await jobs.put('pack:cap-rebuild:payment','pack-payment','failed',{signature:'old',raw:'old',automaticRetry:true});
    const chain={execute:async(_id:string,_kind:string,build:()=>unknown)=>build()} as unknown as Chain;
    const p=new Providers(chain,jobs);p.packPayment=async()=>{throw new Error('Must not request or build a replacement');};
    await assert.rejects(p.purchase('cap-rebuild',25,{...settings,dailyCapUsd:0}),/spending cap/);
  }finally{await db.close();}
});

test('an unconfirmed failure cannot authorize a replacement transaction',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);const jobs=new Jobs(db),signer=Keypair.generate();
  const chain=new Chain(jobs);chain.require=()=>({signer,rpc:{getSignatureStatuses:async()=>({value:[{confirmationStatus:'processed',err:{InstructionError:[0,'Custom']}}]})} as any});
  try{
    await jobs.put('not-final','swap','submitted',{signature:'old',raw:'old',blockhash:'old'});
    await assert.rejects(chain.execute('not-final','swap',async()=>{throw new Error('must not build');},settings),PendingOperation);
    await assert.rejects(chain.recover('not-final'),PendingOperation);
    assert.equal((await jobs.get('not-final')).data.signature,'old');
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
