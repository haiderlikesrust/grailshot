import { randomInt, randomUUID } from 'node:crypto';
import { createTargets, scoreShot, targetVisible, TARGET_SLOT_MS, type Target } from '../shared/game';
import type { Prize, RoundView, Standing } from '../shared/types';
import { atomic, audit, type Database } from './db';
import { PendingOperation, ReviewRequired } from './jobs';
import type { Treasury } from './treasury';
import { config } from './config';
export type Round={id:string;coinMint?:string;number:number;status:string;deadline:number;stage:number;targets:Target[];contenders:string[];prize:Prize|null;tier:number|null;winner:string|null;message:string|null;eligibilitySupply?:string;reviewReason?:string;retryAt?:number;retryFailures?:number};
export class Engine {
  current:Round|null=null;
  standings:Standing[]=[];
  private lastPurchaseRetry=0;
  private retry(error:unknown){const r=this.current!;r.retryFailures=error instanceof PendingOperation?0:(r.retryFailures??0)+1;r.retryAt=Date.now()+(error instanceof PendingOperation?3000:Math.min(60_000,3000*2**Math.min(r.retryFailures,5)));}
  constructor(readonly db:Database,readonly treasury:Treasury,readonly online:(wallet:string)=>boolean,readonly coinMint=config.MEMECOIN_MINT){}
  async persist(){if(!this.current)return;const{number,...data}=this.current;await this.db.query('UPDATE rounds SET status=$2,data=$3 WHERE id=$1',[data.id,data.status,JSON.stringify(data)]);}
  async init(){
    const rows=(await this.db.query("SELECT * FROM rounds WHERE status NOT IN('complete','cancelled','interrupted','carried') ORDER BY number DESC")).rows;
    for(const row of rows){const r={...row.data,number:Number(row.number)} as Round;
      if(r.coinMint!==this.coinMint){this.treasury.coinHistoryBlocker='Unfinished rounds from a previous or unlabelled coin need reconciliation before new rounds can start.';this.treasury.view.ready=false;this.treasury.view.blockers=this.treasury.blockers();continue;}
      if(['purchasing','awarding','review'].includes(r.status)&&!this.current){this.current=r;continue;}
      if(r.prize)await this.db.query("UPDATE prizes SET status='available',round_id=NULL WHERE id=$1 AND winner IS NULL",[r.prize.id]);r.status='interrupted';r.message='The match was interrupted. Its prize is reserved for a new round.';await this.db.query('UPDATE rounds SET status=$2,data=$3 WHERE id=$1',[r.id,r.status,JSON.stringify(r)]);
    }
    await this.reloadStandings();
  }
  async reloadStandings(){this.standings=this.current?(await this.db.query('SELECT e.wallet,p.name,e.score,e.shots,e.disqualified FROM entries e JOIN players p ON p.wallet=e.wallet WHERE round_id=$1 ORDER BY score DESC,wallet',[this.current.id])).rows as Standing[]:[];}
  async create(prize:Prize|null,tier:number|null){const id=randomUUID(),round={id,coinMint:this.coinMint,status:'registration',deadline:Date.now()+30_000,stage:0,targets:[],contenders:[],prize,tier,winner:null,message:null};const row=(await this.db.query('INSERT INTO rounds(id,status,data,created_at) VALUES($1,$2,$3,$4) RETURNING number',[id,round.status,JSON.stringify(round),Date.now()])).rows[0];this.current={...round,number:Number(row.number)};this.standings=[];if(prize)await this.db.query("UPDATE prizes SET status='reserved',round_id=$2 WHERE id=$1",[prize.id,id]);}
  async join(wallet:string){const r=this.current;if(!r||r.status!=='registration'||r.deadline<=Date.now())throw new Error('Registration opens when the next pack is funded.');if(!this.online(wallet))throw new Error('Stay connected to the live arena before joining.');if(this.standings.some(p=>p.wallet===wallet))return;if(this.standings.length>=200)throw new Error('This round is full. Join the next drop.');const check=await this.treasury.chain.eligibility(wallet);if(r.deadline<=Date.now())throw new Error('Registration has closed.');if(!check.configured)throw new Error('Live rounds open when the token launches.');if(!check.eligible)throw new Error('Hold at least 0.1% of the coin to enter.');await this.db.query('INSERT INTO entries(round_id,wallet) VALUES($1,$2) ON CONFLICT DO NOTHING',[r.id,wallet]);await this.reloadStandings();}
  view(wallet?:string,now=Date.now()):RoundView|null{const r=this.current;if(!r||r.coinMint!==this.coinMint)return null;const player=this.standings.find(s=>s.wallet===wallet);const target=r.status==='live'?r.targets.find(t=>targetVisible(t,now))??null:null;return{id:r.id,number:r.number,status:r.status,deadline:r.deadline,stage:r.stage,entrants:this.standings.filter(s=>!s.disqualified).length,standings:this.standings,prize:r.prize,tier:r.tier,winner:r.winner,message:r.message,registered:!!player,target,canShoot:!!player&&!player.disqualified&&r.status==='live'&&r.contenders.includes(wallet!)};}
  async shot(wallet:string,roundId:string,targetId:string,x:number,y:number,receivedAt:number,latency:number){const r=this.current;if(!r||r.id!==roundId||r.status!=='live'||!r.contenders.includes(wallet))throw new Error('You are not playing in this round.');const target=r.targets.find(t=>t.id===targetId);if(!target)throw new Error('Unknown target.');const score=scoreShot(target,x,y,receivedAt,latency);if(score===null)throw new Error('That shot missed the target window.');
    await atomic(this.db,async()=>{const inserted=await this.db.query('INSERT INTO shots(round_id,wallet,target_id,x,y,score,received_at,latency) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING target_id',[r.id,wallet,targetId,x,y,score,receivedAt,latency]);if(!inserted.rows.length)throw new Error('One shot per target.');await this.db.query('UPDATE entries SET score=score+$3,shots=shots+1 WHERE round_id=$1 AND wallet=$2',[r.id,wallet,score]);});await this.reloadStandings();
    const standing=this.standings.find(p=>p.wallet===wallet)!;
    return{roundId:r.id,targetId,accepted:true as const,score,totalScore:standing.score,shots:standing.shots};
  }
  async scheduleTargets(wallets:string[],count:number){const r=this.current!;const startsAt=Date.now()+5000;r.status='countdown';r.deadline=startsAt;r.contenders=wallets;r.targets=createTargets(startsAt,count,()=>randomInt(0,1_000_000)/1_000_000,randomUUID);r.message=r.stage?`Tiebreaker ${r.stage} · ${wallets.length} players remain`:'React fast. Ten flashes. One winner.';await this.persist();}
  async step(){const now=Date.now(),t=this.treasury;let r=this.current;
    if(t.coinHistoryBlocker)return;
    if(!r||['complete','cancelled','carried','interrupted'].includes(r.status)){
      await t.maintain();if(!t.view.ready||t.settings.paused||!t.view.rpc.ok)return;
      if(r&&now<r.deadline)return;
      const prize=(await this.db.query("SELECT data FROM prizes WHERE status='available' AND winner IS NULL AND data->>'coinMint'=$1 LIMIT 1",[this.coinMint])).rows[0]?.data??null;
      const tier=t.affordable();if(!prize&&!tier)return;await this.create(prize,tier);return;
    }
    if(r.status==='registration'){
      await t.maintain();
      if(t.settings.paused){r.message='New rounds are paused.';r.deadline=now+30_000;await this.persist();return;}
      if(now<r.deadline)return;
      try{
        for(const p of this.standings){const check=this.online(p.wallet)?await t.chain.eligibility(p.wallet):null;if(!check?.eligible)await this.db.query('DELETE FROM entries WHERE round_id=$1 AND wallet=$2',[r.id,p.wallet]);}
        await this.reloadStandings();if(this.standings.length<2){r.deadline=now+30_000;r.message='Waiting for at least two eligible holders online.';await this.persist();return;}
        if(!r.prize){await t.refresh();const tier=t.affordable();if(!t.view.ready||!tier){r.deadline=now+30_000;r.message='Waiting for available pack funds.';await this.persist();return;}r.tier=tier;r.status='purchasing';r.deadline=0;r.message='Opening the pack. Stay connected.';await this.persist();return;}
        await this.scheduleTargets(this.standings.map(p=>p.wallet),10);
      }catch{r.deadline=now+10_000;r.message='Verifying holdings. Registration resumes shortly.';await this.persist();}return;
    }
    if(r.status==='purchasing'){
      if(t.settings.paused)return;if(now<(r.retryAt??0)||now-this.lastPurchaseRetry<3000)return;this.lastPurchaseRetry=now;
      try{r.prize=await t.providers.purchase(r.id,r.tier!,t.settings);await this.db.query("UPDATE prizes SET status='reserved',round_id=$2 WHERE id=$1",[r.prize.id,r.id]);t.opened();r.retryAt=0;r.retryFailures=0;r.status='registration';r.deadline=0;r.message='Prize secured. Rechecking connected holders.';await this.persist();}
      catch(error){this.retry(error);if(error instanceof PendingOperation){r.message='The pack is being confirmed. Recovery runs automatically.';}else{r.message=error instanceof ReviewRequired?'The pack needs owner review. Any purchased prize is preserved.':'The pack is delayed. Retrying automatically; your place and prize are preserved.';await audit(this.db,'pack-delay',{round:r.id,error:(error as Error).message});await this.db.query('UPDATE jobs SET error=$2,updated_at=$3 WHERE id=$1',[`pack:${r.id}`,(error as Error).message,Date.now()]);if(error instanceof ReviewRequired)r.status='review';}await this.persist();}return;
    }
    if(r.status==='countdown'&&now>=r.deadline){r.status='live';r.deadline=r.deadline+r.targets.length*TARGET_SLOT_MS+100;r.message=null;await this.persist();return;}
    if(r.status==='live'&&now>=r.deadline){r.status='adjudicating';r.deadline=0;await this.persist();return;}
    if(r.status==='adjudicating'){
      if(r.deadline&&now<r.deadline)return;
      try{
        await this.reloadStandings();const valid=this.standings.filter(p=>!p.disqualified).sort((a,b)=>b.score-a.score);
        if(!valid.length||valid[0].score===0){await this.carry('No valid scoring shots. The prize carries into the next round.');return;}
        const top=valid.filter(p=>p.score===valid[0].score);
        for(const p of top){if(!(await t.chain.eligibility(p.wallet)).eligible){await this.db.query('UPDATE entries SET disqualified=TRUE WHERE round_id=$1 AND wallet=$2',[r.id,p.wallet]);await this.reloadStandings();return;}}
        if(top.length>1){if(r.stage>=3){await this.carry('Still tied after three tiebreakers. The same prize returns next round.');return;}r.stage++;await this.scheduleTargets(top.map(p=>p.wallet),5);return;}
        const winner=top[0];const metrics=(await this.db.query('SELECT COUNT(*) FILTER(WHERE score>=99)::int AS perfect, COUNT(*)::int AS total FROM shots WHERE round_id=$1 AND wallet=$2',[r.id,winner.wallet])).rows[0];
        const shots=(await this.db.query('SELECT target_id,received_at,latency,score FROM shots WHERE round_id=$1 AND wallet=$2',[r.id,winner.wallet])).rows;const fast=shots.filter(s=>{const target=r.targets.find(t=>t.id===s.target_id);return target&&s.score>0&&Number(s.received_at)-Math.min(75,Number(s.latency)/2)-target.startsAt<100;}).length;
        r.winner=winner.wallet;if(metrics.perfect>=8||fast>=4){r.status='review';r.reviewReason='Suspicious reaction pattern';r.message='Result held for integrity review. The prize remains reserved.';await this.persist();await audit(this.db,'integrity-review',{round:r.id,wallet:winner.wallet,metrics});return;}
        r.status='awarding';r.message='Winner confirmed. Transferring the card.';await this.persist();
      }catch(error){if(error instanceof ReviewRequired)throw error;r.message='Checking the final result. The prize is reserved.';r.deadline=now+3000;await this.persist();}return;
    }
    if(r.status==='awarding'){
      if(now<(r.retryAt??0)||now-this.lastPurchaseRetry<3000)return;this.lastPurchaseRetry=now;
      try{const signature=await t.chain.transferNft(`award:${r.prize!.id}`,r.prize!.mint,r.winner!,t.settings);
        r.prize!.transferSignature=signature;await atomic(this.db,async()=>{await this.db.query("UPDATE prizes SET status='awarded',winner=$2,round_id=$3,transfer_signature=$4,data=$5 WHERE id=$1 AND (winner IS NULL OR winner=$2)",[r.prize!.id,r.winner,r.id,signature,JSON.stringify(r.prize)]);r.status='complete';r.deadline=now+10_000;r.message='Card delivered. The next grail is waiting.';await this.persist();});t.lastRefresh=0;
      }catch(error){this.retry(error);r.message='Your card is reserved. Transfer recovery runs automatically.';if(!(error instanceof PendingOperation)){await audit(this.db,'award-delay',{round:r.id,error:(error as Error).message});if(error instanceof ReviewRequired){r.status='review';r.reviewReason='Transfer needs recovery';r.message='The transfer needs owner review. Your card remains reserved.';}}await this.persist();}return;
    }
  }
  async carry(message:string){const r=this.current!;if(r.prize)await this.db.query("UPDATE prizes SET status='available',round_id=NULL WHERE id=$1 AND winner IS NULL",[r.prize.id]);r.status='carried';r.deadline=Date.now()+10_000;r.message=message;await this.persist();}
  async recover(approveWinner=false){
    const r=this.current;
    if(!r||!['review','purchasing','adjudicating','awarding'].includes(r.status))throw new Error('No paused round needs recovery.');
    if(['Near-perfect input pattern','Suspicious reaction pattern'].includes(r.reviewReason??'')){
      if(!approveWinner)throw new Error('Inspect the shot audit, then explicitly approve the winner or requeue the prize.');
      if(r.winner&&!(await this.treasury.chain.eligibility(r.winner)).eligible){
        await this.db.query('UPDATE entries SET disqualified=TRUE WHERE round_id=$1 AND wallet=$2',[r.id,r.winner]);
        r.winner=null;r.reviewReason=undefined;r.status='adjudicating';r.deadline=0;r.message='Standings are being rechecked.';await this.reloadStandings();await this.persist();return;
      }
    }
    if(r.winner)r.status='awarding';
    else if(r.prize){await this.carry('The prize is returning in a fresh contest.');return;}
    else{
      const pack=await this.treasury.providers.jobs.get(`pack:${r.id}`);
      if(pack?.data.memo){const status=await this.treasury.providers.cc(`/pack/status?memo=${encodeURIComponent(pack.data.memo)}`);if(status.pack?.refunded&&status.pack.refund_transaction_signature&&!status.send){r.status='cancelled';r.deadline=0;r.message='The provider refunded this unopened pack. Funds remain in the treasury.';await this.treasury.providers.jobs.put(pack.id,'pack','complete',{...pack.data,refunded:true,refundSignature:status.pack.refund_transaction_signature});await this.persist();this.treasury.lastRefresh=0;return;}}
      r.status='purchasing';
    }
    r.retryAt=0;r.retryFailures=0;r.message='Recovery in progress.';await this.persist();
  }
}
