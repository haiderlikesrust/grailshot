import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, TARGET_MS, TARGET_SLOT_MS, createTargets, position, scoreShot, targetVisible, eligible, cadence, selectPack, type Target } from '../shared/game';

const target:Target={id:'one',startsAt:10_000,x:500,y:280,phase:0,direction:1};
const hit=(delay:number,rtt=0)=>{const p=position(target,target.startsAt+delay);return scoreShot(target,p.x,p.y,target.startsAt+delay+rtt/2,rtt);};

test('600 ms flashes reward reaction speed as well as aim',()=>{
  assert.equal(TARGET_MS,600);
  assert.equal(hit(0),100);
  assert.equal(hit(200),77);
  assert.equal(hit(400),53);
  assert.ok(hit(599)!>0);
  assert.equal(hit(600),null);
  const p=position(target,target.startsAt+200);
  assert.ok(scoreShot(target,p.x+25,p.y,target.startsAt+200,0)!<hit(200)!);
  assert.equal(scoreShot(target,p.x+ARENA.radius+1,p.y,target.startsAt+200,0),0);
});
test('shots reject early, expired, non-finite and out-of-arena input',()=>{
  assert.equal(hit(-1),null);
  assert.equal(hit(601),null);
  assert.equal(scoreShot(target,NaN,280,10_200,0),null);
  assert.equal(scoreShot(target,-1,280,10_200,0),null);
  assert.equal(scoreShot(target,500,Infinity,10_200,0),null);
  assert.equal(scoreShot(target,500,280,10_200,NaN),null);
});
test('bounded network compensation preserves scores across ordinary latency',()=>{
  for(const rtt of [0,20,80,150])assert.equal(hit(250,rtt),hit(250));
  assert.equal(hit(550,300),null,'latency claims cannot extend compensation beyond 75 ms');
  assert.equal(targetVisible(target,9999),false);
  assert.equal(targetVisible(target,10_600),false);
});
test('unpredictable appearances have no overlap and stay within a 15 second contest',()=>{
  let id=0;
  const targets=createTargets(10_000,10,Math.random,()=>String(id++));
  assert.equal(new Set(targets.map(t=>t.id)).size,10);
  for(let i=0;i<targets.length;i++){
    const t=targets[i];
    assert.ok(t.startsAt>=10_000+i*TARGET_SLOT_MS+150);
    assert.ok(t.startsAt<=10_000+i*TARGET_SLOT_MS+800);
    if(i)assert.ok(t.startsAt-targets[i-1].startsAt-TARGET_MS>=250);
    for(const elapsed of [0,100,300,599]){
      const p=position(t,t.startsAt+elapsed);
      assert.ok(p.x>=ARENA.radius&&p.x<=ARENA.width-ARENA.radius);
      assert.ok(p.y>=ARENA.radius&&p.y<=ARENA.height-ARENA.radius);
    }
  }
  assert.ok(targets.at(-1)!.startsAt+TARGET_MS<25_000);
});
test('holder eligibility uses exact integers and sums all accounts',()=>{
  const supply='1000000000000000000000';
  assert.equal(eligible(['999999999999999999'],supply),false);
  assert.equal(eligible(['1000000000000000000'],supply),true);
  assert.equal(eligible(['1000000000000000001'],supply),true);
  assert.equal(eligible(['400000000000000000','600000000000000000'],supply),true);
  assert.equal(eligible(['1'],'0'),false);
});
test('cadence boundaries and spendable pack limits',()=>{
  assert.equal(cadence(1499,99),300_000);
  assert.equal(cadence(1500,0),60_000);
  assert.equal(cadence(0,600),60_000);
  assert.equal(cadence(299,99),600_000);
  assert.equal(cadence(300,0),300_000);
  assert.equal(cadence(0,100),300_000);
  const dollars=(n:number)=>BigInt(n)*1_000_000n;
  assert.equal(selectPack(24_999_999n,dollars(500),[25,50,100]),null);
  for(const tier of [25,50,100])assert.equal(selectPack(dollars(tier),dollars(500),[25,50,100]),25);
  assert.equal(selectPack(dollars(100),dollars(49),[25,50,100]),25);
  assert.equal(selectPack(dollars(100),dollars(500),[25,50]),25);
  assert.equal(selectPack(dollars(100),dollars(500),[]),null);
  assert.equal(selectPack(dollars(100),dollars(24),[25,50,100]),null);
});

test('adaptive packs preserve small balances and mix stocked tiers at larger balances',()=>{
  const dollars=(n:number)=>BigInt(n)*1_000_000n,stock=[25,50,100,500];
  let balance=100;
  for(let count=0;count<4;count++){const tier=selectPack(dollars(balance),null,stock,count);assert.equal(tier,25);balance-=tier!;}
  assert.equal(selectPack(0n,null,stock,4),null);
  assert.deepEqual(Array.from({length:10},(_,i)=>selectPack(dollars(1000),null,stock,i)),[25,50,25,100,25,50,25,100,50,25]);
  assert.equal(selectPack(dollars(10_000),null,stock,9),500);
  assert.equal(selectPack(dollars(9999),null,stock,9),25);
  assert.equal(selectPack(dollars(10_000),null,[25,50,100],9),100);
  assert.equal(selectPack(dollars(10_000),dollars(49),stock,9),25);
  assert.equal(selectPack(dollars(100),null,[50,100,500],9),null);
});
