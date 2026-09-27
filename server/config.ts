import 'dotenv/config';
import { z } from 'zod';
const env = z.object({ MAINNET_ENABLED: z.enum(['true', 'false']).default('false'), PORT: z.coerce.number().default(4100), TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0), HOST: z.string().default('127.0.0.1'), APP_ORIGIN: z.string().url().default('http://localhost:5173'), DATABASE_URL: z.string().optional(), MEMECOIN_MINT: z.string().default(''), OWNER_WALLET: z.string().default(''), FEE_RECIPIENT: z.string().default(''), TREASURY_PRIVATE_KEY: z.string().trim().default(''), SOLANA_RPC_URL: z.string().default(''), JUPITER_API_KEY: z.string().default(''), COLLECTOR_CRYPT_API_KEY: z.string().default(''), COLLECTOR_CRYPT_PAYMENT_WALLET: z.string().default(''), CARDS_MINT: z.string().default('CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp'), USDC_MINT: z.string().default('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), DAILY_CAP_USD: z.coerce.number().nonnegative().default(0), GAS_RESERVE_SOL: z.coerce.number().min(0.01).default(0.05), SLIPPAGE_BPS: z.coerce.number().min(1).max(100).default(100) }).parse(process.env);
export const config = { ...env, live: env.MAINNET_ENABLED === 'true' };
export function configBlockers() {
  const missing = (['MEMECOIN_MINT', 'OWNER_WALLET', 'FEE_RECIPIENT', 'TREASURY_PRIVATE_KEY', 'SOLANA_RPC_URL', 'JUPITER_API_KEY', 'COLLECTOR_CRYPT_PAYMENT_WALLET'] as const).filter(key => !config[key]).map(key => `Configure ${key}`);
  if (!config.DATABASE_URL) missing.push('Configure PostgreSQL DATABASE_URL for mainnet');
  if (!config.live) missing.push('Mainnet spending is disabled');
  return missing;
}
