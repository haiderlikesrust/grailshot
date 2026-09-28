'use client';
import { useEffect, useState } from 'react';
import { ShieldCheck, ArrowDownUp } from 'lucide-react';
import type { Prize, BuybackQuote } from '@/shared/types';
import { api } from './use-game';

const usd=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
export function PrizeValues({prize}:{prize:Prize}){
  const [quote,setQuote]=useState<BuybackQuote|null>(null);
  useEffect(()=>{
    let disposed=false;setQuote(null);
    const refresh=()=>api<BuybackQuote>(`/prizes/${encodeURIComponent(prize.mint)}/buyback`).then(q=>{if(!disposed)setQuote(q);}).catch(()=>{if(!disposed)setQuote({status:'error',amount:null,checkedAt:Date.now()});});
    void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},60_000);
    return()=>{disposed=true;clearInterval(timer);};
  },[prize.mint]);
  return <div className="prize-values" aria-label="Card value">
    <div><span><ShieldCheck size={14}/>Insured value</span><strong>{prize.value>0?usd(prize.value):'Not provided'}</strong></div>
    <div><span><ArrowDownUp size={14}/>Buyback quote</span><strong>{quote?.status==='available'&&quote.amount!==null?usd(quote.amount):quote?.status==='unavailable'?'Not available':quote?.status==='error'?'Unavailable':'Checking…'}</strong></div>
    <small>{quote?.status==='available'?'Collector Crypt offer · subject to availability':'Insured value provided by Collector Crypt'}</small>
  </div>;
}
