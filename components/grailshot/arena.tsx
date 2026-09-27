'use client';
import { useEffect, useRef, useState } from 'react';
import { Crosshair, RotateCcw, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ARENA, createTargets, position, scoreShot, targetVisible, TARGET_MS, TARGET_SLOT_MS, type Target } from '@/shared/game';
import type { RoundView } from '@/shared/types';
export const SAMPLE_IMAGE='https://d1xpxki1g4htqu.cloudfront.net/VKobKA3N200A3MTKTgzzMKx3LbU5iqaBPQXyfBW4e9w';
export function Arena({round,offset,onShot,onFps,onJoin,joinLabel,practice,setPractice}:{round:RoundView|null;offset:{current:number};onShot:(id:string,x:number,y:number)=>void;onFps:(fps:number)=>void;onJoin:()=>void;joinLabel:string;practice:boolean;setPractice:(v:boolean)=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null), state=useRef({round,practice}), shotIds=useRef(new Set<string>()), practiceTargets=useRef<Target[]>([]), practiceScore=useRef(0), practiceEnds=useRef(0), reactions=useRef<number[]>([]), effect=useRef<{x:number;y:number;at:number;text:string}|null>(null);
  const [result,setResult]=useState<number|null>(null),[practicePoints,setPracticePoints]=useState(0);
  const [averageReaction,setAverageReaction]=useState<number|null>(null);
  state.current={round,practice};
  const active=practice||round?.status==='live'||round?.status==='countdown';
  useEffect(()=>{if(practice) { const startsAt=Date.now()+1000; practiceTargets.current=createTargets(startsAt,10,Math.random,()=>crypto.randomUUID());practiceEnds.current=startsAt+10*TARGET_SLOT_MS;practiceScore.current=0;reactions.current=[];effect.current=null;shotIds.current.clear();setResult(null);setPracticePoints(0);setAverageReaction(null);}},[practice]);
  useEffect(()=>{if(round?.registered&&['countdown','live'].includes(round.status))setPractice(false);},[round?.registered,round?.status,setPractice]);
  useEffect(()=>{
    let raf=0,frames=0,measure=performance.now();const image=new Image();let imageSource='';
    function render() {
      const el=canvas.current,ctx=el?.getContext('2d');if(!el||!ctx)return;
      const now=Date.now(),s=state.current;ctx.clearRect(0,0,1000,560);
      ctx.strokeStyle='rgba(74,142,167,.075)';ctx.lineWidth=1;
      for(let x=0;x<1000;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,560);ctx.stroke();}for(let y=0;y<560;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1000,y);ctx.stroke();}
      const source=s.practice?SAMPLE_IMAGE:s.round?.prize?.image||SAMPLE_IMAGE;if(source!==imageSource){imageSource=source;image.src=source;}
      const at=s.practice?now:now+offset.current;
      const target=s.practice?practiceTargets.current.find(t=>targetVisible(t,at)):s.round?.target;
      if(targetVisible(target,at) && !shotIds.current.has(target.id) && (s.practice||s.round?.status==='live')) {
        const p=position(target,at);
        const w=ARENA.cardWidth,h=ARENA.cardHeight,remaining=Math.max(0,(target.startsAt+TARGET_MS-at)/TARGET_MS);
        ctx.save();ctx.translate(p.x,p.y);ctx.shadowColor='#27b8ed55';ctx.shadowBlur=18;ctx.fillStyle='#0b151c';ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.fill();ctx.shadowBlur=0;
        ctx.save();ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.clip();
        if(image.complete&&image.naturalWidth){const scale=Math.min(w/image.naturalWidth,h/image.naturalHeight),iw=image.naturalWidth*scale,ih=image.naturalHeight*scale;ctx.drawImage(image,-iw/2,-ih/2,iw,ih);}
        ctx.restore();ctx.strokeStyle='#b6dff34d';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(-w/2,-h/2,w,h,5);ctx.stroke();
        // Four small brackets frame the full card without covering its artwork.
        ctx.strokeStyle='#6ed7ff';ctx.lineWidth=2;
        for(const sx of [-1,1])for(const sy of [-1,1]){const cx=sx*(w/2+5),cy=sy*(h/2+5);ctx.beginPath();ctx.moveTo(cx-sx*11,cy);ctx.lineTo(cx,cy);ctx.lineTo(cx,cy-sy*11);ctx.stroke();}
        ctx.strokeStyle='#09141cd9';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();ctx.strokeStyle='#fff4df';ctx.lineWidth=1.3;ctx.stroke();
        ctx.fillStyle='#213640';ctx.fillRect(-w/2,h/2+10,w,2);ctx.fillStyle='#ff9b69';ctx.fillRect(-w/2,h/2+10,w*remaining,2);ctx.restore();
      }
      const e=effect.current;if(e&&now-e.at<400){ctx.save();ctx.globalAlpha=1-(now-e.at)/400;ctx.strokeStyle='#ff8752';ctx.fillStyle='#f4fbff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.x,e.y,10+(now-e.at)/15,0,Math.PI*2);ctx.stroke();ctx.font='600 18px "IBM Plex Mono", monospace';ctx.textAlign='center';ctx.fillText(e.text,Math.max(105,Math.min(895,e.x)),Math.max(78,e.y-35));ctx.restore();}
      if(s.round?.status==='countdown'&&!s.practice){ctx.fillStyle='#eef7ff';ctx.font='700 72px "Space Grotesk", sans-serif';ctx.textAlign='center';ctx.fillText(String(Math.max(1,Math.ceil((s.round.deadline-at)/1000))),500,290);}
      if(s.practice&&practiceTargets.current.length&&now>=practiceEnds.current){setResult(practiceScore.current);setAverageReaction(reactions.current.length?Math.round(reactions.current.reduce((a,b)=>a+b,0)/reactions.current.length):null);setPractice(false);practiceTargets.current=[];}
      frames++;if(performance.now()-measure>1000){onFps(Math.round(frames*1000/(performance.now()-measure)));measure=performance.now();frames=0;}
      raf=requestAnimationFrame(render);
    }raf=requestAnimationFrame(render);return()=>cancelAnimationFrame(raf);
  },[offset,onFps,setPractice]);
  function fire(event:React.PointerEvent<HTMLCanvasElement>) {
    if(!active)return;const now=Date.now(),at=practice?now:now+offset.current,target=practice?practiceTargets.current.find(t=>targetVisible(t,at)):round?.target;
    if(!targetVisible(target,at)||shotIds.current.has(target.id)||(!practice&&!round?.canShoot))return;
    const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*1000,y=(event.clientY-rect.top)/rect.height*560;
    const points=scoreShot(target,x,y,at,0)??0,reaction=Math.round(at-target.startsAt);
    shotIds.current.add(target.id);effect.current={x,y,at:now,text:practice?(points>0?`${reaction} ms · +${points}`:'MISS'):'SHOT'};
    if(practice){practiceScore.current+=points;if(points>0)reactions.current.push(reaction);setPracticePoints(practiceScore.current);}else onShot(target.id,x,y);
  }
  const prize=round?.prize;
  return <div className={`arena ${active?'arena-active':''}`}>
    <div className="arena-top"><span className="arena-mode"><Crosshair size={14}/>{practice?'PRACTICE RANGE':'HOLDER VS HOLDER'}</span><span>{practice?`${practicePoints} PTS`:'SOLANA / ARENA 01'}</span></div>
    <canvas ref={canvas} width={1000} height={560} onPointerDown={fire} aria-label="Sniping arena. Click or tap the center of each moving card target." />
    {!active&&<div className="arena-idle">
      <div className="scope-circle scope-one"/><div className="scope-circle scope-two"/><div className="scope-axis"/>
      <div className="prize-stage"><div className="card-orbit"/><img className="hero-card" src={prize?.image||"/brand/grailshot-pack-v2.png"} alt={prize?.name||'GRAILSHOT sealed pack artwork'}/></div>
      <div className="arena-callout"><span className="eyebrow blue">{result!==null?'RANGE COMPLETE':prize?'THE GRAIL IS IN PLAY':'YOUR NEXT GRAIL AWAITS'}</span><h2>{result!==null?<>{result}<span className="points-suffix"> / 1,000</span></>:prize?prize.name:<>HOLD YOUR COIN.<br/><span>TAKE YOUR SHOT.</span></>}</h2><p>{result!==null?<>{averageReaction!==null?<strong className="blue">{averageReaction} ms average hit · </strong>:null}Practice score only. React fast and aim true.</>:prize?'One card. One winner. Make every shot count.':'Creator fees fund the packs. Compete with holders online. The fastest accurate shot takes the card.'}</p><Button className="orange-button arena-cta" onClick={onJoin}><Crosshair size={17}/>{joinLabel}<ArrowUpRight size={16}/></Button><button className="practice-link" disabled={!!round?.registered&&['countdown','live'].includes(round.status)} onClick={()=>setPractice(true)}><RotateCcw size={13}/> {result!==null?'Try the range again':'Warm up in the practice range'}</button></div>
    </div>}
    <div className="arena-bottom"><span><i className="live-dot"/>{active?'REACT FAST · 600 MS TO HIT':prize?'VERIFIED PRIZE IN TREASURY':'WAITING FOR A FUNDED ROUND'}</span><span>{!prize&&!active?'POKÉMON PACKS · $25 / $50 / $100':practice?'PRACTICE · NO PRIZES':'SPEED + ACCURACY'}</span></div>
    {active&&<button className="range-exit" onClick={()=>setPractice(false)} hidden={!practice}>Exit practice</button>}
  </div>;
}


