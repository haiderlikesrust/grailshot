import { config, configBlockers } from './config';
import { DEFAULT_CADENCE, cadence, selectPack } from '../shared/game';
import { NATIVE_MINT } from '@solana/spl-token';
import type { Settings, TreasuryView } from '../shared/types';
import type { Database } from './db';
import { Chain } from './chain';
import { Providers } from './providers';
import { PendingOperation } from './jobs';
export class Treasury {
  settings:Settings={paused:false,dailyCapUsd:config.DAILY_CAP_USD,gasReserveSol:config.GAS_RESERVE_SOL,slippageBps:config.SLIPPAGE_BPS,cadence:DEFAULT_CADENCE};
  view:TreasuryView={enabled:config.live,ready:false,paused:false,available:0,rate:0,claimed:0,spentToday:0,cadenceMinutes:10,nextAt:0,reserve:config.GAS_RESERVE_SOL,cardsBalance:'0',address:null,rpc:{ok:false,latency:null,checkedAt:null},blockers:[],error:null};
  lastRefresh=0;lastOpening=Date.now();availableMicros=0n;tiers:number[]=[];
  constructor(readonly db:Database,readonly chain:Chain,readonly providers:Providers){}
  async init(){const row=(await this.db.query('SELECT data FROM settings WHERE id=1')).rows[0];if(row)this.settings=row.data;else await this.save(this.settings);this.view.blockers=this.blockers();this.view.address=this.chain.address;this.view.reserve=this.settings.gasReserveSol;const last=(await this.db.query("SELECT created_at FROM ledger WHERE kind='pack' ORDER BY created_at DESC LIMIT 1")).rows[0];if(last)this.lastOpening=Number(last.created_at);}
  blockers(){return[...configBlockers(),...(this.settings.dailyCapUsd<=0?['Set a daily spending cap']:[]),...(this.chain.address&&this.chain.address!==config.FEE_RECIPIENT?['Treasury signer must match FEE_RECIPIENT']:[])];}
  async save(settings:Settings){await this.db.query('INSERT INTO settings(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(settings)]);this.settings=settings;this.lastRefresh=0;this.view.paused=settings.paused;this.view.blockers=this.blockers();this.view.ready=this.view.blockers.length===0;}
  async refresh(){this.lastRefresh=Date.now();await this.chain.health();this.view.rpc=this.chain.rpc;this.view.blockers=this.blockers();this.view.ready=!this.view.blockers.length;this.view.paused=this.settings.paused;this.view.reserve=this.settings.gasReserveSol;this.view.address=this.chain.address;
    if(!this.view.ready)return;
    const [usdc,cards,sol,machines]=await Promise.all([this.chain.balance(config.USDC_MINT),this.chain.balance(config.CARDS_MINT),this.chain.balance(NATIVE_MINT.toBase58()),this.providers.machines()]);
    if(sol<BigInt(Math.round(this.settings.gasReserveSol*1e9))){this.view.ready=false;this.view.blockers.push('Treasury needs more SOL for its gas reserve');return;}
    let cardsValue=0n;if(cards>0n){const quote=await this.providers.quote(config.CARDS_MINT,config.USDC_MINT,cards);cardsValue=BigInt(quote.outAmount??'0')*(10_000n-BigInt(this.settings.slippageBps))/10_000n;}
    const reserved=(await this.db.query("SELECT COALESCE(SUM((r.data->>'tier')::bigint*1000000),0)::text AS amount FROM rounds r WHERE r.status='purchasing' AND NOT EXISTS(SELECT 1 FROM ledger l WHERE l.id='pack:'||r.id)")).rows[0];
    const total=usdc+cardsValue-BigInt(reserved.amount);this.availableMicros=total>0n?total:0n;this.tiers=machines.map((m:any)=>m.price);
    const now=Date.now(),day=new Date();day.setUTCHours(0,0,0,0);
    const sums=(await this.db.query("SELECT COALESCE(SUM(CASE WHEN kind='fee' AND created_at>$1 THEN amount_micros ELSE 0 END),0)::text AS recent,COALESCE(SUM(CASE WHEN kind='fee' THEN amount_micros ELSE 0 END),0)::text AS claimed,COALESCE(SUM(CASE WHEN kind='pack' AND created_at>=$2 THEN amount_micros ELSE 0 END),0)::text AS spent FROM ledger",[now-900_000,day.getTime()])).rows[0];
    this.view.available=Number(this.availableMicros)/1e6;this.view.rate=Number(sums.recent)/1e6*4;this.view.claimed=Number(sums.claimed)/1e6;this.view.spentToday=Number(sums.spent)/1e6;this.view.cardsBalance=cards.toString();this.view.cadenceMinutes=cadence(this.view.rate,this.view.available,this.settings.cadence)/60_000;
    const next=this.lastOpening+this.view.cadenceMinutes*60_000;this.view.nextAt=this.view.nextAt?Math.min(this.view.nextAt,next):next;this.view.error=null;
  }
  affordable(){return selectPack(this.availableMicros,BigInt(Math.max(0,Math.floor((this.settings.dailyCapUsd-this.view.spentToday)*1e6))),this.tiers);}
  async maintain(){if(Date.now()-this.lastRefresh<30_000)return;try{await this.refresh();if(this.view.ready&&!this.settings.paused)await this.providers.collectFees(this.settings);}catch(error){if(!(error instanceof PendingOperation)){this.view.error=(error as Error).message;this.view.ready=false;}}}
  opened(){this.lastOpening=Date.now();this.view.nextAt=this.lastOpening+this.view.cadenceMinutes*60_000;this.lastRefresh=0;}
}
