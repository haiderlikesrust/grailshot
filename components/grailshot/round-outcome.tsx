'use client';
import { Trophy, ExternalLink } from 'lucide-react';
import type { RoundView } from '@/shared/types';
import { shortWallet } from '@/shared/game';
import { PrizeValues } from './prize-values';

export function RoundOutcome({round,wallet,compact=false}:{round:RoundView;wallet?:string;compact?:boolean}){
  const winner=round.standings.find(p=>p.wallet===round.winner),confirmed=['complete','awarding'].includes(round.status)&&!!round.winner;
  const yours=confirmed&&round.winner===wallet;
  return <div className={`round-outcome ${compact?'outcome-compact':''}`}>
    <span className="eyebrow"><Trophy size={16}/>{confirmed?`ROUND #${round.number} · ${round.status==='complete'?'WINNER':'WINNER CONFIRMED'}`:round.status==='review'?'RESULT UNDER REVIEW':round.status==='carried'?'PRIZE CARRIES FORWARD':'VERIFYING THE RESULT'}</span>
    <h2>{confirmed?(yours?'YOU WON THE GRAIL.':winner?.name||shortWallet(round.winner!)):round.status==='carried'?'THE GRAIL RETURNS.':'HOLD TIGHT.'}</h2>
    {confirmed?<div className="winner-identity"><a href={`https://solscan.io/account/${round.winner}`} target="_blank" rel="noreferrer" title={round.winner!}>{shortWallet(round.winner!)} <ExternalLink size={13}/></a><strong>{winner?.score??0}<small> PTS</small></strong></div>:<p>{round.status==='review'?'No winner is final until the review is complete.':round.status==='carried'?'No winner this time. The same card returns in the next contest.':'Checking scores and holdings before confirming the winner.'}</p>}
    {round.prize&&<><p className="outcome-card-name">{round.prize.name}</p><PrizeValues prize={round.prize}/></>}
    {confirmed&&<div className="outcome-delivery">{round.status==='complete'?'Card delivered to the winner.':'Transferring the card to the winner…'}{round.prize?.transferSignature&&<a href={`https://solscan.io/tx/${round.prize.transferSignature}`} target="_blank" rel="noreferrer">View transfer <ExternalLink size={13}/></a>}</div>}
  </div>;
}
