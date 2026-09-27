import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import WebSocket from 'ws';
import { createApp } from '../server/app';
import { openDatabase, migrate } from '../server/db';
import { challenge, verify } from '../server/auth';
import { Engine } from '../server/engine';
import { position, TARGET_MS } from '../shared/game';
import type { Chain } from '../server/chain';
import type { Providers } from '../server/providers';
import type { Treasury } from '../server/treasury';
import type { Prize } from '../shared/types';

test('signed wallet challenges reject forgery, replay and expiry',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  try{
    const key=Keypair.generate(),other=Keypair.generate();
    const c=await challenge(db,key.publicKey.toBase58());
    const sign=(secret:Uint8Array)=>bs58.encode(nacl.sign.detached(new TextEncoder().encode(c.message),secret));
    await assert.rejects(verify(db,c.id,sign(other.secretKey)),/invalid/);
    assert.equal((await verify(db,c.id,sign(key.secretKey))).wallet,key.publicKey.toBase58());
    await assert.rejects(verify(db,c.id,sign(key.secretKey)),/already used/);
    const expired=await challenge(db,key.publicKey.toBase58());
    await db.query('UPDATE challenges SET expires_at=0 WHERE id=$1',[expired.id]);
    await assert.rejects(verify(db,expired.id,sign(key.secretKey)),/expired/);
  }finally{await db.close();}
});

test('three online holders share targets; duplicate tabs and forged/repeated shots cannot add scores',async()=>{
  const db=await openDatabase(undefined,'memory://');
  const fakeChain={init:async()=>{},address:null,rpc:{ok:true,latency:5,checkedAt:Date.now()},eligibility:async()=>({configured:true,eligible:true})} as unknown as Chain;
  const service=await createApp({db,chain:fakeChain,providers:{} as Providers,timers:false,logger:false});
  const sockets:WebSocket[]=[];
  try{
    await service.app.listen({host:'127.0.0.1',port:0});
    const port=(service.app.server.address() as {port:number}).port;
    const players:{wallet:string;cookie:string;socket:WebSocket}[]=[];
    for(let i=0;i<3;i++){
      const key=Keypair.generate(),wallet=key.publicKey.toBase58();
      const c=(await service.app.inject({method:'POST',url:'/api/auth/challenge',payload:{wallet}})).json();
      const response=await service.app.inject({method:'POST',url:'/api/auth/verify',payload:{id:c.id,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(c.message),key.secretKey))}});
      const cookie=String(response.headers['set-cookie']).split(';')[0];
      const socket=new WebSocket(`ws://127.0.0.1:${port}/api/ws`,{origin:'http://localhost:5173',headers:{cookie}});
      sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('message',()=>resolve());socket.once('error',reject);});
      players.push({wallet,cookie,socket});
    }
    await service.engine.create(null,25);
    for(const p of players)assert.equal((await service.app.inject({method:'POST',url:'/api/rounds/join',headers:{cookie:p.cookie}})).statusCode,200);
    await service.app.inject({method:'POST',url:'/api/rounds/join',headers:{cookie:players[0].cookie}});
    assert.equal(service.engine.standings.length,3);
    assert.equal(service.clients.size,3);
    await service.engine.scheduleTargets(players.map(p=>p.wallet),10);
    const r=service.engine.current!,target=r.targets[0];r.status='live';target.startsAt=Date.now()-180;
    const one=service.engine.view(players[0].wallet)!,two=service.engine.view(players[1].wallet)!;
    assert.deepEqual(one.target,two.target);
    assert.ok(!('targets' in one),'future target sequence must stay private');
    assert.equal(service.engine.view(players[0].wallet,target.startsAt-1)!.target,null);
    assert.equal(service.engine.view(players[0].wallet,target.startsAt+TARGET_MS)!.target,null);
    const p=position(target,Date.now());
    const accepted=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Shot acknowledgement timed out')),3000);players[0].socket.on('message',b=>{const event=JSON.parse(b.toString());if(event.type==='snapshot'&&event.data.round?.standings.some((s:any)=>s.wallet===players[0].wallet&&s.shots===1)){clearTimeout(timeout);resolve();}});});
    players[0].socket.send(JSON.stringify({type:'shot',roundId:r.id,targetId:target.id,x:p.x,y:p.y,score:999999,clientTime:target.startsAt}));
    await accepted;
    const scored=service.engine.standings.find(s=>s.wallet===players[0].wallet)!;
    assert.ok(scored.score>0&&scored.score<100);
    await assert.rejects(service.engine.shot(players[0].wallet,r.id,target.id,p.x,p.y,Date.now(),0),/One shot/);
    await assert.rejects(service.engine.shot(players[0].wallet,r.id,randomUUID(),p.x,p.y,Date.now(),0),/Unknown target/);
    players[0].socket.close();
    assert.equal((await db.query('SELECT score,shots FROM entries WHERE wallet=$1',[players[0].wallet])).rows[0].shots,1,'disconnect does not erase accepted shots');
  }finally{for(const socket of sockets)socket.terminate();await service.app.close();}
});

test('registration retains funds with fewer than two eligible online players',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  let purchases=0;
  const treasury={maintain:async()=>{},settings:{paused:false},providers:{purchase:async()=>{purchases++;}},chain:{eligibility:async()=>({eligible:true,configured:true})}} as unknown as Treasury;
  const engine=new Engine(db,treasury,()=>true);
  try{await engine.create(null,25);engine.current!.deadline=0;await engine.step();assert.equal(engine.current!.status,'registration');assert.equal(purchases,0);}finally{await db.close();}
});

test('ties get three five-target tiebreakers, then carry the same prize',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  const treasury={chain:{eligibility:async()=>({eligible:true})}} as unknown as Treasury;
  const engine=new Engine(db,treasury,()=>true);
  const prize:Prize={id:randomUUID(),mint:'test-prize',name:'Fixture only',image:'',value:0,rarity:'Test'};
  try{
    await db.query("INSERT INTO prizes(id,mint,data,status) VALUES($1,$2,$3,'available')",[prize.id,prize.mint,JSON.stringify(prize)]);
    await engine.create(prize,25);
    for(const wallet of ['one','two']){await db.query('INSERT INTO players(wallet,name,created_at) VALUES($1,$1,0)',[wallet]);await db.query('INSERT INTO entries(round_id,wallet,score,shots) VALUES($1,$2,100,2)',[engine.current!.id,wallet]);}
    for(let stage=1;stage<=3;stage++){engine.current!.status='adjudicating';engine.current!.deadline=0;await engine.step();assert.equal(engine.current!.stage,stage);assert.equal(engine.current!.status,'countdown');assert.equal(engine.current!.targets.length,5);}
    engine.current!.status='adjudicating';engine.current!.deadline=0;await engine.step();assert.equal(engine.current!.status,'carried');
    assert.equal((await db.query('SELECT status FROM prizes WHERE id=$1',[prize.id])).rows[0].status,'available');
  }finally{await db.close();}
});

test('restart interrupts an incomplete match and preserves its prize without choosing a winner',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);
  const prize:Prize={id:randomUUID(),mint:'restart-fixture',name:'Fixture only',image:'',value:0,rarity:'Test'};
  try{
    await db.query("INSERT INTO prizes(id,mint,data,status) VALUES($1,$2,$3,'available')",[prize.id,prize.mint,JSON.stringify(prize)]);
    const engine=new Engine(db,{} as Treasury,()=>true);await engine.create(prize,25);engine.current!.status='live';await engine.persist();
    const restarted=new Engine(db,{} as Treasury,()=>true);await restarted.init();
    assert.equal(restarted.current,null);
    assert.equal((await db.query('SELECT status FROM rounds')).rows[0].status,'interrupted');
    const preserved=(await db.query('SELECT status,winner FROM prizes')).rows[0];assert.equal(preserved.status,'available');assert.equal(preserved.winner,null);
  }finally{await db.close();}
});

test('RPC failure pauses adjudication, then an ineligible leader is removed and standings recalculate',async()=>{
  const db=await openDatabase(undefined,'memory://');await migrate(db);let unavailable=true,checks=0;
  const treasury={chain:{eligibility:async(wallet:string)=>{checks++;if(unavailable)throw new Error('RPC unavailable');return{eligible:wallet==='runner-up'};}}} as unknown as Treasury;
  const engine=new Engine(db,treasury,()=>true);
  try{
    await engine.create(null,25);
    for(const [wallet,score]of [['leader',500],['runner-up',400]] as const){await db.query('INSERT INTO players(wallet,name,created_at) VALUES($1,$1,0)',[wallet]);await db.query('INSERT INTO entries(round_id,wallet,score,shots) VALUES($1,$2,$3,10)',[engine.current!.id,wallet,score]);}
    engine.current!.status='adjudicating';engine.current!.deadline=0;
    await engine.step();assert.equal(engine.current!.status,'adjudicating');assert.equal(engine.current!.winner,null);
    const previous=checks;await engine.step();assert.equal(checks,previous,'RPC retry waits for the pause deadline');
    unavailable=false;engine.current!.deadline=0;await engine.step();
    assert.equal(engine.standings.find(s=>s.wallet==='leader')?.disqualified,true);
    await engine.step();assert.equal(engine.current!.winner,'runner-up');assert.equal(engine.current!.status,'awarding');
  }finally{await db.close();}
});
