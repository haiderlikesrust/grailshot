'use client';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, RotateCcw, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ARENA, createTargets, position, scoreShot, targetVisible, TARGET_MS, TARGET_SLOT_MS, type Target } from '@/shared/game';
import type { RoundView, ShotResult } from '@/shared/types';
import { PrizeValues } from './prize-values';
import { RoundOutcome } from './round-outcome';
export const SAMPLE_IMAGE='/brand/practice-card-v1.webp';
type Feedback={text:string;detail:string;tone:'hit'|'miss'|'pending'};
export function Arena({round,offset,onShot,onFps,onJoin,joinLabel,practice,setPractice,shotResult,wallet}:{round:RoundView|null;offset:{current:number};onShot:(id:string,x:number,y:number)=>boolean;onFps:(fps:number)=>void;onJoin:()=>void;joinLabel:string;practice:boolean;setPractice:(v:boolean)=>void;shotResult?:ShotResult|null;wallet?:string}) {
  const canvas=useRef<HTMLCanvasElement>(null), state=useRef({round,practice}), shotIds=useRef(new Set<string>()), practiceTargets=useRef<Target[]>([]), practiceScore=useRef(0), practiceEnds=useRef(0), reactions=useRef<number[]>([]), effect=useRef<{x:number;y:number;at:number;text:string;tone:Feedback['tone']}|null>(null);
  const pendingShots=useRef(new Map<string,{x:number;y:number;at:number;timedOut?:boolean}>()),seenTarget=useRef<Target|null>(null);
  const [feedback,setFeedback]=useState<Feedback|null>(null);
  const [result,setResult]=useState<number|null>(null),[practicePoints,setPracticePoints]=useState(0);
  const [averageReaction,setAverageReaction]=useState<number|null>(null);
  state.current={round,practice};
  const active=practice||round?.status==='live'||round?.status==='countdown';
  useEffect(()=>{if(practice) { const startsAt=Date.now()+1000; practiceTargets.current=createTargets(startsAt,10,Math.random,()=>crypto.randomUUID());practiceEnds.current=startsAt+10*TARGET_SLOT_MS;practiceScore.current=0;reactions.current=[];effect.current=null;shotIds.current.clear();pendingShots.current.clear();seenTarget.current=null;setFeedback(null);setResult(null);setPracticePoints(0);setAverageReaction(null);}},[practice]);
  useEffect(()=>{shotIds.current.clear();effect.current=null;pendingShots.current.clear();seenTarget.current=null;setFeedback(null);setResult(null);},[round?.id,round?.stage]);
  useEffect(()=>{
    if(!shotResult||shotResult.roundId!==round?.id||practice)return;
    const pending=pendingShots.current.get(shotResult.targetId);if(!pending)return;
    pendingShots.current.delete(shotResult.targetId);
    const text=shotResult.accepted?(shotResult.score>0?`+${shotResult.score} PTS`:'MISS · 0'):shotResult.message.includes('target window')?'TOO LATE · 0':'NOT COUNTED';
    const tone=shotResult.accepted&&shotResult.score>0?'hit':'miss';
    effect.current={x:pending.x,y:pending.y,at:Date.now(),text,tone};
    setFeedback({text,tone,detail:shotResult.accepted?`${shotResult.totalScore} total points · confirmed`:shotResult.message});
  },[shotResult,round?.id,practice]);
  useEffect(()=>{if(round?.registered&&['countdown','live'].includes(round.status))setPractice(false);},[round?.registered,round?.status,setPractice]);
  useEffect(()=>{
    let raf=0,frames=0,measure=performance.now();const image=new Image();let imageSource='';
    function render() {
      const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
      const now=Date.now(),s=state.current;ctx.clearRect(0,0,1000,560);
      // The CSS grid is static. Fetch target art only when it can be needed.
      const source=s.practice?SAMPLE_IMAGE:s.round?.prize?.image;
      if(source&&source!==imageSource){imageSource=source;image.decoding='async';image.referrerPolicy='no-referrer';image.src=source;}
      const at=s.practice?now:now+offset.current;
      const target=s.practice?practiceTargets.current.find(t=>targetVisible(t,at)):s.round?.target;
      if(s.practice||s.round?.canShoot){
        if(targetVisible(target,at))seenTarget.current=target;
        const seen=seenTarget.current;
        if(seen&&at>=seen.startsAt+TARGET_MS){
          if(!shotIds.current.has(seen.id)){shotIds.current.add(seen.id);setFeedback({text:'TOO SLOW · 0',detail:'Target expired without a shot',tone:'miss'});}
          seenTarget.current=null;
        }
      }
      for(const pending of pendingShots.current.values())if(!pending.timedOut&&now-pending.at>3000){pending.timedOut=true;setFeedback({text:'UNCONFIRMED',detail:'Connection delayed · check your score',tone:'pending'});}
      if(targetVisible(target,at) && !shotIds.current.has(target.id) && (s.practice||s.round?.status==='live')) {
        const p=position(target,at);
        const w=ARENA.cardWidth,h=ARENA.cardHeight,remaining=Math.max(0,(target.startsAt+TARGET_MS-at)/TARGET_MS);
        ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor='#ffe05244';ctx.shadowBlur=14;ctx.fillStyle='#242b1c';ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.fill();ctx.shadowBlur=0;
        ctx.save();ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.clip();
        if(image.complete&&image.naturalWidth){const scale=Math.min(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*scale,ih=image.naturalHeight*scale;ctx.drawImage(image,-iw/2,-ih/2,iw,ih);}
        ctx.restore();ctx.strokeStyle='#fff3af4d';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.stroke();
        // Four small brackets frame the full card without covering its artwork.
        ctx.strokeStyle='#ffe052';ctx.lineWidth=2;
        for(const sx of [-1,1])for(const sy of [-1,1]){const cx=sx*(w/2+5),cy=sy*(h/2+5);ctx.beginPath();ctx.moveTo(cx-sx*11,cy);ctx.lineTo(cx,cy);ctx.lineTo(cx,cy-sy*11);ctx.stroke();}
        ctx.strokeStyle='#10150bd9';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();ctx.strokeStyle='#fff4df';ctx.lineWidth=1.3;ctx.stroke();
        ctx.fillStyle='#424c30';ctx.fillRect(-w/2,h/2+10,w,2);ctx.fillStyle='#ffe052';ctx.fillRect(-w/2,h/2+10,w*remaining,2);ctx.restore();
      }
      const e=effect.current;if(e&&now-e.at<700){ctx.save();ctx.globalAlpha=1-(now-e.at)/700;ctx.strokeStyle=e.tone==='miss'?'#ff9e8c':'#ffe052';ctx.fillStyle=e.tone==='miss'?'#ffb7a9':'#fff8db';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,10+(now-e.at)/20,0,Math.PI*2);ctx.stroke();ctx.font='700 24px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.fillText(e.text,Math.max(130,Math.min(870,e.x)),Math.max(90,e.y-35));ctx.restore();}
      if(s.round?.status==='countdown'&&!s.practice){ctx.fillStyle='#fff8db';ctx.font='700 72px "Space Grotesk", sans-serif';ctx.textAlign='center';ctx.fillText(String(Math.max(1,Math.ceil((s.round.deadline-at)/1000))),500,290);}
      if(s.practice&&practiceTargets.current.length&&now>=practiceEnds.current){setResult(practiceScore.current);setAverageReaction(reactions.current.length?Math.round(reactions.current.reduce((a,b)=>a+b,0)/reactions.current.length):null);setPractice(false);practiceTargets.current=[];}
      frames++;if(performance.now()-measure>1000){onFps(Math.round(frames*1000/(performance.now()-measure)));measure=performance.now();frames=0;}
      raf=requestAnimationFrame(render);
    }raf=requestAnimationFrame(render);return()=>cancelAnimationFrame(raf);
  },[offset,onFps,setPractice]);
  function fire(event:React.PointerEvent<HTMLCanvasElement>) {
    if(!active)return;const now=Date.now(),at=practice?now:now+offset.current,target=practice?practiceTargets.current.find(t=>targetVisible(t,at)):round?.target;
    if(!targetVisible(target,at)||shotIds.current.has(target.id)||(!practice&&!round?.canShoot))return;
    const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*1000,y=(event.clientY-rect.top)/rect.height*560;
    shotIds.current.add(target.id);
    if(practice){
      const points=scoreShot(target,x,y,at,0)??0,reaction=Math.round(at-target.startsAt),text=points>0?`+${points} PTS`:'MISS · 0',tone=points>0?'hit':'miss';
      effect.current={x,y,at:now,text,tone};practiceScore.current+=points;if(points>0)reactions.current.push(reaction);setPracticePoints(practiceScore.current);
      setFeedback({text,tone,detail:points>0?`${reaction} ms reaction · practice`:'Aim inside the card · practice'});
    }else{
      pendingShots.current.set(target.id,{x,y,at:now});setFeedback({text:'CHECKING…',detail:'Waiting for confirmed score',tone:'pending'});
      if(!onShot(target.id,x,y)){pendingShots.current.delete(target.id);setFeedback({text:'NOT SENT',detail:'Connection lost · this shot was not submitted',tone:'miss'});}
    }
  }
  const prize=round?.prize;
  const outcome=!!round&&['complete','awarding','adjudicating','review','carried'].includes(round.status);
  const standing=round?.standings.find(p=>p.wallet===wallet);
  const score=Math.max(standing?.score??0,shotResult?.roundId===round?.id&&shotResult?.accepted?shotResult.totalScore:0);
  return <div className={`arena ${active?'arena-active':''} ${outcome&&!practice?'arena-outcome':''}`}>
    <div className="arena-top"><span className="arena-mode"><Crosshair size={14}/>{practice?'PRACTICE RANGE':'HOLDER VS HOLDER'}</span><span className="arena-score">{practice?`${practicePoints} PTS · PRACTICE`:active&&standing?`${score} PTS · YOUR SCORE`:'SOLANA / ARENA 01'}</span></div>
    {active&&feedback&&<div className={`shot-feedback feedback-${feedback.tone}`} role="status" aria-live="polite"><strong>{feedback.text}</strong><span>{feedback.detail}</span></div>}
    <canvas ref={canvas} width={1000} height={560} onPointerDown={fire} aria-label="Sniping arena. Click or tap the center of each moving card target." />
    {!active&&<div className="arena-idle">
      <div className="scope-circle scope-one"/><div className="scope-circle scope-two"/><div className="scope-axis"/>
      <div className="prize-stage"><div className="card-orbit"/><img className="hero-card" src={prize?.image||"/brand/grailshot-pack-v6-720.webp"} srcSet={prize?.image?undefined:"/brand/grailshot-pack-v6-360.webp 360w, /brand/grailshot-pack-v6-720.webp 720w"} sizes={prize?.image?undefined:"(max-width: 680px) 220px, (max-width: 1100px) 300px, 360px"} alt={prize?.name||'GRAILSHOT sealed foil pack'} width={prize?.image?360:720} height={prize?.image?510:1080} fetchPriority="high" decoding="async" referrerPolicy="no-referrer"/></div>
      <div className="arena-callout">{outcome&&result===null?<RoundOutcome round={round!} wallet={wallet}/>:<><span className="eyebrow blue">{result!==null?'RANGE COMPLETE':prize?'THE GRAIL IS IN PLAY':'YOUR NEXT GRAIL AWAITS'}</span><h2>{result!==null?<>{result}<span className="points-suffix"> / 1,000</span></>:prize?prize.name:<>HOLD YOUR COIN.<br/><span>TAKE YOUR SHOT.</span></>}</h2><p>{result!==null?<>{averageReaction!==null?<strong className="blue">{averageReaction} ms average hit · </strong>:null}Practice score only. React fast and aim true.</>:prize?'One card. One winner. Make every shot count.':'Creator fees fund the packs. Compete with holders online. The fastest accurate shot takes the card.'}</p>{prize&&result===null&&<PrizeValues prize={prize}/>}<Button className="orange-button arena-cta" onClick={onJoin}><Crosshair size={17}/>{joinLabel}<ArrowUpRight size={16}/></Button></>}<button className="practice-link" disabled={!!round?.registered&&['countdown','live'].includes(round.status)} onClick={()=>setPractice(true)}><RotateCcw size={13}/> {result!==null?'Try the range again':'Warm up in the practice range'}</button></div>
    </div>}
    <div className="arena-bottom"><span><i className="live-dot"/>{active?'REACT FAST · 600 MS TO HIT':round?.status==='complete'?'PRIZE DELIVERED':prize?'VERIFIED PRIZE IN TREASURY':'WAITING FOR A FUNDED ROUND'}</span><span>{!prize&&!active?'POKÉMON PACKS · $25 / $50 / $100':practice?'PRACTICE · NO PRIZES':'SPEED + ACCURACY'}</span></div>
    {active&&<button className="range-exit" onClick={()=>setPractice(false)} hidden={!practice}>Exit practice</button>}
  </div>;
}


