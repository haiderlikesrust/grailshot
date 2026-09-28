'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from './use-game';
import { shortWallet } from '@/shared/game';

export function OwnerReview({onNotice}:{onNotice:(message:string)=>void}) {
  const [review,setReview]=useState<any>(null),[busy,setBusy]=useState(false);
  async function inspect(){try{setReview(await api('/admin/round/shots'));}catch(e){onNotice((e as Error).message);}}
  async function recover(action:{approveWinner?:boolean;requeue?:boolean}){setBusy(true);try{await api('/admin/round/recover',action);onNotice(action.requeue?'Prize requeued for a fresh contest.':'Round recovery requested.');await inspect();}catch(e){onNotice((e as Error).message);}finally{setBusy(false);}}
  return <div className="owner-review"><Button variant="outline" onClick={inspect}>Inspect current round and shots</Button>{review&&<div className="review-details"><h3>Round {review.round?.number??'—'} · {review.round?.status??'No active round'}</h3>{review.round?.reviewReason&&<p>{review.round.reviewReason}</p>}{review.round?.winner&&<p>Proposed winner: {review.round.winner}</p>}<div className="review-shots"><Table><TableHeader><TableRow><TableHead>Wallet</TableHead><TableHead>Target</TableHead><TableHead>Score</TableHead><TableHead>RTT</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{review.shots.map((shot:any)=><TableRow key={`${shot.wallet}:${shot.target_id}`}><TableCell>{shortWallet(shot.wallet)}</TableCell><TableCell>{shot.target_id.slice(0,8)}</TableCell><TableCell>{shot.score}</TableCell><TableCell>{shot.latency} ms</TableCell><TableCell>{new Date(Number(shot.received_at)).toLocaleTimeString()}</TableCell></TableRow>)}</TableBody></Table></div>{review.round?.status==='review'&&<div className="review-actions">{['Near-perfect input pattern','Suspicious reaction pattern'].includes(review.round.reviewReason)&&<Button disabled={busy} onClick={()=>recover({approveWinner:true})}>Approve reviewed winner</Button>}{review.round.prize&&<Button variant="outline" disabled={busy} onClick={()=>recover({requeue:true})}>Void contest and requeue prize</Button>}</div>}</div>}</div>;
}
