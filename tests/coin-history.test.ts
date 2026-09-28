import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { createApp } from '../server/app';
import { openDatabase, migrate } from '../server/db';
import { Engine } from '../server/engine';
import type { Chain } from '../server/chain';
import type { Providers } from '../server/providers';
import type { Treasury } from '../server/treasury';

test('public results, rankings and profiles exclude foreign and unlabelled history without deleting it',async()=>{
  const db=await openDatabase(undefined,'memory://');
  const service=await createApp({db,chain:{init:async()=>{},address:null,rpc:{}} as unknown as Chain,providers:{} as Providers,timers:false,logger:false});
  const wallet=Keypair.generate().publicKey.toBase58();
  try{
    await db.query('INSERT INTO players(wallet,name,created_at) VALUES($1,$2,0)',[wallet,'Same player']);
    // Seed the current coin first so a later foreign/legacy win cannot become its latest result.
    const scopes=[service.engine.coinMint,'previous-coin',undefined];
    const ids:string[]=[];
    for(const [index,coinMint] of scopes.entries()){
      const engine=new Engine(db,service.treasury,()=>false,coinMint??'legacy');
      await engine.create(null,25);const round=engine.current!;ids.push(round.id);
      const prize={id:randomUUID(),mint:randomUUID(),coinMint,name:'Fixture',image:'',value:31+index,rarity:'Test'};
      round.coinMint=coinMint;round.status='complete';round.winner=wallet;round.prize=prize;await engine.persist();
      await db.query('INSERT INTO entries(round_id,wallet,score,shots) VALUES($1,$2,$3,10)',[round.id,wallet,208+index*100]);
      await db.query("INSERT INTO prizes(id,mint,data,round_id,winner,status) VALUES($1,$2,$3,$4,$5,'awarded')",[prize.id,prize.mint,JSON.stringify(prize),round.id,wallet]);
    }
    const latest=(await service.app.inject('/api/rounds/latest-result')).json();
    assert.equal(latest.id,ids[0]);assert.equal(latest.standings[0].score,208);
    const leaders=(await service.app.inject('/api/leaderboard')).json().players;
    assert.deepEqual(leaders,[{wallet,name:'Same player',wins:1,valueWon:31,bestScore:208}]);
    const profile=(await service.app.inject(`/api/profiles/${wallet}`)).json();
    assert.equal(profile.wins,1);assert.equal(profile.valueWon,31);assert.equal(profile.bestScore,208);
    assert.deepEqual(profile.matches.map((m:any)=>m.id),[ids[0]]);assert.equal(profile.prizes.length,1);
    assert.equal((await db.query('SELECT id FROM rounds')).rows.length,3);
    assert.equal((await db.query('SELECT id FROM prizes')).rows.length,3);
    // Switching away from a completed coin has no active result; round numbering remains global.
    const next=new Engine(db,service.treasury,()=>false,'new-coin');await next.init();assert.equal(next.view(),null);
    await next.create(null,25);assert.equal(next.current!.number,4);assert.equal(next.current!.coinMint,'new-coin');
  }finally{await service.app.close();}
});

test('a new coin has empty public history when only test wins exist',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  const round={id:randomUUID(),status:'complete',winner:'test-winner'};
  await db.query("INSERT INTO rounds(id,status,data,created_at) VALUES($1,'complete',$2,0)",[round.id,JSON.stringify(round)]);
  const service=await createApp({db,chain:{init:async()=>{},address:null,rpc:{}} as unknown as Chain,providers:{} as Providers,timers:false,logger:false});
  try{assert.equal((await service.app.inject('/api/rounds/latest-result')).json(),null);assert.deepEqual((await service.app.inject('/api/leaderboard')).json(),{players:[]});assert.equal(service.engine.view(),null);}finally{await service.app.close();}
});

test('unfinished foreign and unlabelled rounds remain intact and block coordinator spending',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  let calls=0;
  const treasury={view:{ready:true},blockers:()=>['Previous coin needs reconciliation'],maintain:async()=>{calls++;},providers:{purchase:async()=>{calls++;}}} as unknown as Treasury;
  try{
    const old=new Engine(db,treasury,()=>false,'old-coin');await old.create(null,25);old.current!.status='purchasing';await old.persist();
    await old.create(null,25);old.current!.coinMint=undefined;old.current!.status='awarding';await old.persist();
    const before=(await db.query('SELECT * FROM rounds ORDER BY number')).rows;
    const next=new Engine(db,treasury,()=>false,'new-coin');await next.init();await next.step();
    assert.equal(next.current,null);assert.equal(treasury.view.ready,false);assert.match(treasury.coinHistoryBlocker!,/previous or unlabelled/);assert.equal(calls,0);
    assert.deepEqual((await db.query('SELECT * FROM rounds ORDER BY number')).rows,before);
  }finally{await db.close();}
});

test('only available prizes assigned to the current coin can be carried into its next round',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  const treasury={maintain:async()=>{},view:{ready:true,rpc:{ok:true}},settings:{paused:false},affordable:()=>null} as unknown as Treasury;
  try{
    const prizes=[];
    for(const coinMint of [undefined,'old-coin','new-coin']){
      const prize={id:randomUUID(),mint:randomUUID(),coinMint,name:'Fixture',value:31,image:'',rarity:'Test'};prizes.push(prize);
      await db.query("INSERT INTO prizes(id,mint,data,status) VALUES($1,$2,$3,'available')",[prize.id,prize.mint,JSON.stringify(prize)]);
    }
    const engine=new Engine(db,treasury,()=>false,'new-coin');await engine.step();
    assert.equal(engine.current!.prize!.id,prizes[2].id);assert.equal(engine.current!.coinMint,'new-coin');
    assert.equal((await db.query("SELECT id FROM prizes WHERE status='available'")).rows.length,2);
  }finally{await db.close();}
});
