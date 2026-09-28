'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot, Player, Eligibility, ShotResult, RoundView } from '@/shared/types';
export async function api<T = any>(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result: any = await response.json(); if (!response.ok) throw new Error(result.error || 'The request could not be completed.'); return result as T;
}
export function useGame() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [player, setPlayer] = useState<Player | null>(null), [holding, setHolding] = useState<Eligibility | null>(null);
  const [connection,setConnection] = useState('connecting'), [ping,setPing] = useState<number | null>(null), [jitter,setJitter] = useState<number | null>(null), [timeouts,setTimeouts] = useState(0), [error,setError] = useState('');
  const socket = useRef<WebSocket | null>(null), offset = useRef(0), rtts = useRef<number[]>([]);
  const [shotResult,setShotResult]=useState<ShotResult|null>(null);
  const [latestResult,setLatestResult]=useState<RoundView|null>(null);
  useEffect(()=>{api<RoundView|null>('/rounds/latest-result').then(result=>setLatestResult(current=>current&&current.number>(result?.number??0)?current:result)).catch(()=>{});},[]);
  useEffect(()=>{setShotResult(null);},[player?.wallet]);
  useEffect(()=>{if(snapshot?.round?.status==='complete')setLatestResult(snapshot.round);},[snapshot?.round]);
  const refreshPlayer = useCallback(async () => { const current = await api<{player:Player|null}>('/me'); setPlayer(current.player); if (current.player) { try { setHolding(await api('/eligibility')); } catch { setHolding(null); } } else setHolding(null); }, []);
  useEffect(() => { refreshPlayer().catch(()=>{}); },[refreshPlayer]);
  useEffect(() => {
    let disposed = false, retry: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>;
    const pending = new Map<string,number>();
    function connect() {
      if (disposed) return;
      const protocol=location.protocol==='https:'?'wss':'ws';
      // The local Worker preview also handles upgrades; connect directly to Fastify in development.
      const endpoint=process.env.NEXT_PUBLIC_GAME_WS_URL||(process.env.NODE_ENV==='development'?`${protocol}://${location.hostname}:4100/api/ws`:`${protocol}://${location.host}/api/ws`);
      const ws = new WebSocket(endpoint); socket.current = ws;
      ws.onopen = () => { setConnection('connected'); setError(''); heartbeat = setInterval(() => { const now=Date.now(); for(const [id,sent] of pending) if(now-sent>5000) { pending.delete(id); setTimeouts(x=>x+1); } const id=crypto.randomUUID(); pending.set(id,now); if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'ping',id})); },2000); };
      ws.onmessage = event => { const data = JSON.parse(event.data); if(data.type==='snapshot') { setSnapshot(data.data); offset.current=data.data.serverTime-Date.now()+(rtts.current.at(-1)??0)/2; } if(data.type==='pong' && pending.has(data.id)) { const rtt=Date.now()-pending.get(data.id)!; pending.delete(data.id); rtts.current=[...rtts.current.slice(-9),rtt]; setPing(Math.round(rtt)); setJitter(Math.round(rtts.current.slice(1).reduce((s,x,i)=>s+Math.abs(x-rtts.current[i]),0)/Math.max(1,rtts.current.length-1))); } if(data.type==='heartbeat') ws.send(JSON.stringify({type:'ack',id:data.id})); if(data.type==='error') setError(data.message); };
      ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.type==='shot-result')setShotResult(data);if(data.type==='target')setSnapshot(current=>current?.round&&current.round.id===data.roundId?{...current,round:{...current.round,target:data.target}}:current);});
      ws.onerror=()=>setConnection('reconnecting'); ws.onclose=()=>{ clearInterval(heartbeat); setConnection('reconnecting'); if(!disposed) retry=setTimeout(connect,2000); };
    }
    connect(); return()=>{disposed=true;clearTimeout(retry);clearInterval(heartbeat);socket.current?.close();};
  },[player?.wallet]);
  const shoot = (targetId:string,x:number,y:number) => { if(socket.current?.readyState!==WebSocket.OPEN||!snapshot?.round)return false;socket.current.send(JSON.stringify({type:'shot',roundId:snapshot.round.id,targetId,x,y}));return true; };
  return {snapshot,player,holding,refreshPlayer,connection,ping,jitter,timeouts,error,setError,shoot,shotResult,latestResult,offset};
}
