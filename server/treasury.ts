import { config, configBlockers } from './config';
import { selectPack } from '../shared/game';
import { NATIVE_MINT } from '@solana/spl-token';
import type { Settings, TreasuryView } from '../shared/types';
import type { Database } from './db';
import { Chain } from './chain';
import { Providers } from './providers';
import { PendingOperation } from './jobs';
export class Treasury {
  settings:Settings={paused:false,dailyCapUsd:null,gasReserveSol:config.GAS_RESERVE_SOL,slippageBps:config.SLIPPAGE_BPS,allocationVersion:1};
  view:TreasuryView={enabled:config.live,ready:false,paused:false,available:0,balanceStatus:'unconfigured',balanceUpdatedAt:null,rate:0,claimed:0,spentToday:0,nextPackTier:null,reserve:config.GAS_RESERVE_SOL,cardsBalance:'0',address:null,rpc:{ok:false,latency:null,checkedAt:null},blockers:[],error:null};
  lastRefresh=0;lastCollection=0;availableMicros=0n;tiers:number[]=[];paidPacks=0;
  constructor(readonly db:Database,readonly chain:Chain,readonly providers:Providers){}
  async init(){const row=(await this.db.query('SELECT data FROM settings WHERE id=1')).rows[0];if(row){const {cadence:legacyCadence,...saved}=row.data;this.settings=saved;if(this.settings.allocationVersion!==1)await this.save({...this.settings,dailyCapUsd:null,allocationVersion:1});else if(legacyCadence)await this.save(this.settings);}else await this.save(this.settings);this.view.blockers=this.blockers();this.view.address=this.chain.address||config.FEE_RECIPIENT||null;this.view.reserve=this.settings.gasReserveSol;}
  blockers(){return[...configBlockers(),...(this.settings.dailyCapUsd!==null&&this.settings.dailyCapUsd<=0?['Set a positive daily cap or enable unlimited spending']:[]),...(this.chain.address&&this.chain.address!==config.FEE_RECIPIENT?['Treasury signer must match FEE_RECIPIENT']:[])];}
  async save(settings:Settings){settings={...settings,allocationVersion:1};await this.db.query('INSERT INTO settings(id,data) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',[JSON.stringify(settings)]);this.settings=settings;this.lastRefresh=0;this.view.paused=settings.paused;this.view.blockers=this.blockers();this.view.ready=false;this.view.nextPackTier=null;}
  async refresh(){
    this.lastRefresh=Date.now();
    this.view.ready=false;
    this.view.nextPackTier=null;
    this.availableMicros=0n;
    this.tiers=[];
    this.view.error=null;
    this.view.blockers=this.blockers();
    this.view.paused=this.settings.paused;
    this.view.reserve=this.settings.gasReserveSol;
    this.view.address=this.chain.address||config.FEE_RECIPIENT||null;
    await this.chain.health();
    this.view.rpc=this.chain.rpc;
    // Reading confirmed holdings does not require permission to claim, swap or buy.
    if(!this.view.address||!config.SOLANA_RPC_URL){this.view.balanceStatus='unconfigured';this.view.nextPackTier=null;return;}
    if(!this.view.rpc.ok){this.view.balanceStatus='unavailable';this.view.nextPackTier=null;this.view.error='Treasury balance check failed. Check the Solana RPC connection.';return;}
    if(!this.view.balanceUpdatedAt)this.view.balanceStatus='checking';
    let usdc:bigint,cards:bigint,sol:bigint,reserved:bigint;
    try{
      [usdc,cards,sol]=await Promise.all([
        this.chain.balance(config.USDC_MINT,this.view.address),
        this.chain.balance(config.CARDS_MINT,this.view.address),
        this.chain.balance(NATIVE_MINT.toBase58(),this.view.address),
      ]);
      reserved=BigInt((await this.db.query("SELECT COALESCE(SUM((r.data->>'tier')::bigint*1000000),0)::text AS amount FROM rounds r WHERE r.status='purchasing' AND NOT EXISTS(SELECT 1 FROM ledger l WHERE l.id='pack:'||r.id)")).rows[0].amount);
      const now=Date.now(),day=new Date();day.setUTCHours(0,0,0,0);
      const sums=(await this.db.query("SELECT COALESCE(SUM(CASE WHEN kind='fee' AND created_at>$1 THEN amount_micros ELSE 0 END),0)::text AS recent,COALESCE(SUM(CASE WHEN kind='fee' THEN amount_micros ELSE 0 END),0)::text AS claimed,COALESCE(SUM(CASE WHEN kind='pack' AND created_at>=$2 THEN amount_micros ELSE 0 END),0)::text AS spent FROM ledger",[now-900_000,day.getTime()])).rows[0];
      this.view.rate=Number(sums.recent)/1e6*4;
      this.view.claimed=Number(sums.claimed)/1e6;
      this.view.spentToday=Number(sums.spent)/1e6;
      this.paidPacks=Number((await this.db.query("SELECT COUNT(*)::int AS count FROM ledger WHERE kind='pack'")).rows[0].count);
      this.view.cardsBalance=cards.toString();
      this.view.balanceUpdatedAt=now;
    }catch{
      this.view.balanceStatus='unavailable';this.view.nextPackTier=null;
      this.view.error='Treasury balances could not be refreshed. Retrying automatically.';
      return;
    }
    if(sol<BigInt(Math.round(this.settings.gasReserveSol*1e9)))this.view.blockers.push('Treasury needs more SOL for its gas reserve');
    let cardsValue=0n;
    if(cards>0n){
      try{
        if(!config.JUPITER_API_KEY)throw new Error('Jupiter key is missing');
        const quote=await this.providers.quote(config.CARDS_MINT,config.USDC_MINT,cards);
        if(quote.errorCode||quote.inputMint!==config.CARDS_MINT||quote.outputMint!==config.USDC_MINT||String(quote.inAmount)!==cards.toString()||!/^\d+$/.test(String(quote.outAmount))||BigInt(quote.outAmount)<=0n)throw new Error('Invalid CARDS valuation');
        cardsValue=BigInt(quote.outAmount)*(10_000n-BigInt(this.settings.slippageBps))/10_000n;
      }catch{
        this.view.balanceStatus='partial';this.view.nextPackTier=null;
        this.view.available=Number(usdc>reserved?usdc-reserved:0n)/1e6;
        this.view.error=config.JUPITER_API_KEY?'CARDS were received, but the USDC quote is unavailable. Check the Jupiter key and provider response.':'CARDS were received. Configure JUPITER_API_KEY to calculate their USDC value.';
        return;
      }
    }
    const total=usdc+cardsValue-reserved;
    this.availableMicros=total>0n?total:0n;
    this.view.available=Number(this.availableMicros)/1e6;
    this.view.balanceStatus='ready';
    // Readiness gates spending only. Funds remain visible during setup or a pause.
    if(this.view.blockers.length){this.view.nextPackTier=null;return;}
    try{this.tiers=(await this.providers.machines()).map((m:any)=>m.price);}
    catch{this.view.nextPackTier=null;this.view.error='Pack availability could not be checked. Retrying automatically.';return;}
    this.view.ready=true;
    this.view.nextPackTier=this.settings.paused?null:this.affordable();
  }
  affordable(){return selectPack(this.availableMicros,this.settings.dailyCapUsd===null?null:BigInt(Math.max(0,Math.floor((this.settings.dailyCapUsd-this.view.spentToday)*1e6))),this.tiers,this.paidPacks);}
  async maintain(){
    if(Date.now()-this.lastRefresh<10_000)return;
    try{
      await this.refresh();
      // Detect deposits promptly without increasing the rate of fee-claim transactions.
      if(this.view.ready&&!this.settings.paused&&Date.now()-this.lastCollection>=30_000){
        this.lastCollection=Date.now();await this.providers.collectFees(this.settings);
      }
    }catch(error){if(!(error instanceof PendingOperation)){this.view.error=(error as Error).message;this.view.ready=false;this.view.nextPackTier=null;}}
  }
  opened(){this.view.nextPackTier=null;this.lastRefresh=0;}
}
