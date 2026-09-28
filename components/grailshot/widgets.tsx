'use client';
import { Activity, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDot, Clock3, Crosshair, Crown, ExternalLink, Gauge, LockKeyhole, Radio, ShieldCheck, Target, Trophy, Users, Wallet, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { shortWallet } from '@/shared/game';
import type { Eligibility, RoundView, TreasuryView } from '@/shared/types';

const usd=(amount=0)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(amount);

export function FundingWidget({treasury}:{treasury?:TreasuryView}) {
  const available=treasury?.available??0;
  const balanceStatus=treasury?.balanceStatus??'checking';
  const priced=balanceStatus==='ready';
  const caption=balanceStatus==='partial'?'CARDS received · valuation pending':balanceStatus==='unavailable'?'Balance temporarily unavailable':balanceStatus==='unconfigured'?'Prize pool awaiting connection':balanceStatus==='checking'?'Checking the prize pool':treasury?.cardsBalance!=='0'?'Estimated USDC after converting CARDS':'Available for the next pack';
  const nextTier=available<25?25:available<50?50:100;
  return <section className="widget fund-panel">
    <header className="widget-header"><span className="widget-icon blue-icon"><Zap size={18}/></span><div><span className="widget-kicker">THE PRIZE POOL</span><h2>The next drop</h2></div><span className="widget-chip">FEE FUNDED</span></header>
    <div className="fund-amount"><span className="fund-currency">$</span>{priced?available.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}<span className="fund-unit">USDC</span></div>
    <p className="fund-caption" role="status">{caption}</p>
    <div className="pack-tiers" aria-label="Affordable pack tiers">{[25,50,100].map(tier=><div className={priced&&available>=tier?'tier-reached':''} key={tier}><span className="tier-tick">{priced&&available>=tier?<Check size={12}/>:<CircleDot size={10}/>}</span><b>${tier}</b><span>PACK</span></div>)}</div>
    <div className="fund-meter"><Progress value={priced?Math.min(100,available/nextTier*100):0} aria-label={`Funding toward a $${nextTier} pack`}/><div><span>{!priced?'Funding total pending':available>=100?'All pack tiers funded':`${usd(Math.max(0,nextTier-available))} to the $${nextTier} pack`}</span><span>{priced?`${Math.min(100,Math.floor(available/nextTier*100))}%`:'—'}</span></div></div>
    <div className="fund-metrics"><div><Activity size={14}/><span>Fee income<b>{usd(treasury?.rate)}<small> / hr</small></b></span></div><div><Clock3 size={14}/><span>Drop cadence<b>{treasury?.enabled?`${treasury.cadenceMinutes} min`:'At launch'}</b></span></div></div>
    <div className="fund-footer"><span className="live-dot"/><span>Creator fees</span><ArrowRight size={11}/><span>$CARDS</span><ArrowRight size={11}/><span>USDC</span>{treasury?.address&&<a href={`https://solscan.io/account/${treasury.address}`} target="_blank" rel="noreferrer" aria-label="View treasury on Solscan"><ExternalLink size={13}/></a>}</div>
  </section>;
}

export function EligibilityWidget({holding,connected,onCheck}:{holding:Eligibility|null;connected:boolean;onCheck:()=>void}) {
  return <section className={`widget eligibility-panel ${holding?.eligible?'access-eligible':''}`}>
    <header className="widget-header"><span className="widget-icon orange-icon">{holding?.eligible?<ShieldCheck size={18}/>:<LockKeyhole size={18}/>}</span><div><span className="widget-kicker">YOUR ACCESS</span><h2>The holder pass</h2></div>{holding?.eligible&&<span className="eligible-chip"><Check size={12}/> Eligible</span>}</header>
    <div className="access-feature"><div><span className="access-number">0.1<span>%</span></span><span className="access-caption">MINIMUM HOLDING</span></div><div className="pass-art" aria-hidden="true"><span>HOLDER PASS</span><Crosshair size={27}/><small>GRAILSHOT</small></div></div>
    <p>{holding?.configured?<>Your wallet holds <b>{holding.percent}%</b> of the supply. {holding.eligible?'You’re ready to compete.':'Reach 0.1% to enter the arena.'}</>:<>Your wallet is your ticket.<br/>Hold the coin. Play for the grail.</>}</p>
    <Button variant="outline" className="access-button" onClick={onCheck}>{holding?.eligible?<Check size={16}/>:<Wallet size={16}/>}<span>{connected?'Refresh holdings':'Check my eligibility'}</span><ArrowUpRight size={16}/></Button>
    <span className="access-note"><ShieldCheck size={12}/> No entry fee. One wallet, one player.</span>
  </section>;
}

export function LobbyWidget({round}:{round?:RoundView|null}) {
  const standings=round?.standings.filter(p=>!p.disqualified)??[];
  return <section className="widget live-scores">
    <header className="widget-header"><span className="widget-icon"><Users size={18}/></span><div><span className="widget-kicker">LIVE MATCH</span><h2>The contenders</h2></div><span className="lobby-count">{standings.length}</span></header>
    {standings.length?<ol>{standings.slice(0,5).map((p,i)=><li key={p.wallet}><span className={`player-avatar ${i===0?'player-leading':''}`}>{i===0?<Crown size={14}/>:String(i+1).padStart(2,'0')}</span><span>{p.name}<small>{shortWallet(p.wallet)}</small></span><b>{p.score}<small>PTS</small></b></li>)}</ol>:<div className="lobby-empty"><div className="empty-players" aria-hidden="true"><span><Users size={16}/></span><span><Crosshair size={22}/></span><span><Users size={16}/></span></div><strong>The arena is yours to claim.</strong><p>Rivals join when a round is funded.</p><span className="lobby-requirement"><span className="waiting-dot"/> 2 holders needed to begin</span></div>}
  </section>;
}

export function RoundStats({round,countdown}:{round?:RoundView|null;countdown:string}) {
  return <div className="round-strip">
    <div className="round-next"><span className="mini-label"><Clock3 size={12}/>{round?.status==='live'?'TIME LEFT':'NEXT DROP'}</span><strong className="countdown">{countdown}</strong></div>
    <div><span className="mini-label"><Users size={12}/>PLAYERS READY</span><strong>{String(round?.entrants??0).padStart(2,'0')}<span className="dim">/ 2 min</span></strong></div>
    <div><span className="mini-label"><Trophy size={12}/>PRIZE PACK</span><strong>{round?.tier?`$${round.tier}`:'$25–100'}</strong></div>
    <div className="round-strip-last"><span className="delivery-icon"><ShieldCheck size={22}/></span><span><b>Winner takes the card.</b><small>Delivered to your wallet</small></span></div>
  </div>;
}

export function NetworkStats({connection,ping,jitter,timeouts,fps,rpc}:{connection:string;ping:number|null;jitter:number|null;timeouts:number;fps:number;rpc?:TreasuryView['rpc']}) {
  return <div className="network-strip" aria-label="Live network statistics">
    <div className={`network-state ${connection==='connected'?'is-connected':''}`}><Radio size={14}/><span>{connection==='connected'?'ONLINE':connection==='connecting'?'CONNECTING':'RECONNECTING'}</span></div>
    <div className="network-metric"><span>PING</span><b>{ping??'—'}<small> ms</small></b></div>
    <div className="network-metric"><span>JITTER</span><b>{jitter??'—'}<small> ms</small></b></div>
    <div className="network-metric"><span>TIMEOUTS</span><b>{timeouts}</b></div>
    <div className="network-metric"><span>FRAME RATE</span><b>{fps||'—'}<small> fps</small></b></div>
    <div className="network-metric network-rpc"><span>SOLANA RPC</span><b>{rpc?.checkedAt?(rpc.ok?<>{rpc.latency}<small> ms</small></>:'Unavailable'):'—'}</b></div>
  </div>;
}

export function LeaderPreview({children,hasLeaders}:{children:React.ReactNode;hasLeaders:boolean}) {
  return <div className="widget leader-preview"><div className="section-title"><div className="section-heading"><span className="widget-icon orange-icon"><Trophy size={18}/></span><div><span className="widget-kicker">THE HALL OF FAME</span><h2>Sharpshooters</h2></div></div><a href="/leaderboard">Rankings<ArrowUpRight size={15}/></a></div>{hasLeaders?children:<div className="leader-empty"><div className="podium-mark" aria-hidden="true"><Crown size={26}/><span>01</span></div><div><strong>Every legend starts with a shot.</strong><p>The first crown is waiting.<br/>Win a live round to claim your place.</p><a href="/leaderboard">See the leaderboard <ChevronRight size={13}/></a></div><span className="first-rank" aria-hidden="true">#01</span></div>}</div>;
}

export function LoopWidget() {
  return <div className="widget how-panel"><div className="section-title"><div className="section-heading"><span className="widget-icon blue-icon"><Target size={18}/></span><div><span className="widget-kicker">THE GRAILSHOT LOOP</span><h2>Fees become your next grail.</h2></div></div></div><div className="steps"><div><span className="step-icon"><Zap size={19}/></span><span className="step-number">01</span><b>Fund the drop</b><p>Creator fees fill the<br/>next Pokémon pack.</p></div><div><span className="step-icon"><Crosshair size={19}/></span><span className="step-number">02</span><b>Win the duel</b><p>10 targets. 600 ms.<br/>React fast. Aim true.</p></div><div><span className="step-icon orange"><Trophy size={19}/></span><span className="step-number">03</span><b>Claim your grail</b><p>The card NFT lands<br/>in the winner’s wallet.</p></div></div></div>;
}
