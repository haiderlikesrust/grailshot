import type { CadenceSettings, Target } from './game';
export type Prize = { id: string; mint: string; name: string; image: string; value: number; rarity: string; purchaseSignature?: string; transferSignature?: string };
export type Standing = { wallet: string; name: string; score: number; shots: number; disqualified?: boolean };
export type RoundView = { id: string; number: number; status: string; deadline: number; stage: number; entrants: number; standings: Standing[]; target: Target | null; prize: Prize | null; tier: number | null; winner: string | null; message: string | null; registered: boolean; canShoot: boolean };
export type TreasuryView = { enabled: boolean; ready: boolean; paused: boolean; available: number; balanceStatus: 'unconfigured' | 'checking' | 'ready' | 'partial' | 'unavailable'; balanceUpdatedAt: number | null; rate: number; claimed: number; spentToday: number; cadenceMinutes: number; nextAt: number; reserve: number; cardsBalance: string; address: string | null; rpc: { ok: boolean; latency: number | null; checkedAt: number | null }; blockers: string[]; error: string | null };
export type Player = { wallet: string; name: string; owner: boolean };
export type Eligibility = { eligible: boolean; balance: string; required: string; supply: string; percent: string; configured: boolean };
export type Snapshot = { serverTime: number; round: RoundView | null; treasury: TreasuryView; online: number; mode: 'local' | 'mainnet'; mint: string | null };
export type Settings = { paused: boolean; dailyCapUsd: number; gasReserveSol: number; slippageBps: number; cadence: CadenceSettings };
