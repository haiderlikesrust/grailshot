export const TARGET_MS = 600;
export const TARGET_SLOT_MS = 1500;
export const ARENA = { width: 1000, height: 560, radius: 52, cardWidth: 80, cardHeight: 116 };
export type Target = { id: string; startsAt: number; x: number; y: number; phase: number; direction: number };
// The full sequence stays on the server. Only the currently visible target is sent.
export function createTargets(startsAt: number, count: number, random: () => number, id: () => string): Target[] {
  return Array.from({ length: count }, (_, i) => ({
    id: id(), startsAt: startsAt + i * TARGET_SLOT_MS + 150 + Math.floor(random() * 651),
    x: 170 + random() * 660, y: 135 + random() * 290,
    phase: random() * Math.PI * 2, direction: random() < .5 ? -1 : 1,
  }));
}
export function targetVisible(target: Target | null | undefined, at: number): target is Target {
  return !!target && at >= target.startsAt && at < target.startsAt + TARGET_MS;
}
export function position(target: Target, at: number) {
  const elapsed = Math.max(0, Math.min(TARGET_MS, at - target.startsAt));
  return { x: target.x + Math.sin(elapsed / 160 + target.phase) * 64 * target.direction, y: target.y + Math.sin(elapsed / 200 + target.phase) * 36 };
}
export function scoreShot(target: Target, x: number, y: number, receivedAt: number, latencyMs: number) {
  if (![x, y, receivedAt, latencyMs].every(Number.isFinite) || x < 0 || x > ARENA.width || y < 0 || y > ARENA.height) return null;
  const compensation = Math.max(0, Math.min(75, latencyMs / 2));
  const at = receivedAt - compensation;
  if (!targetVisible(target, at)) return null;
  const center = position(target, at);
  const dx=Math.abs(x-center.x)/(ARENA.cardWidth/2),dy=Math.abs(y-center.y)/(ARENA.cardHeight/2);
  if (dx>1||dy>1) return 0;
  const reaction = 1 - (at - target.startsAt) / TARGET_MS;
  const accuracy = 1 - Math.hypot(dx,dy)/Math.SQRT2;
  return Math.round(70 * reaction + 30 * accuracy);
}
export function eligible(amounts: string[], supply: string) {
  const total = BigInt(supply);
  return total > 0n && amounts.reduce((sum, x) => sum + BigInt(x), 0n) * 1000n >= total;
}
export const PACK_TIERS = [25, 50, 100, 500] as const;
export function selectPack(availableMicros: bigint, dailyRemainingMicros: bigint | null, tiers: number[], paidPacks=0) {
  // Use confirmed funds only. Small treasuries preserve the number of games;
  // larger ones rotate through five $25, three $50 and two $100 rounds.
  const cycle=[25,50,25,100,25,50,25,100,50,25];
  const slot=Math.max(0,Math.floor(paidPacks))%cycle.length;
  const preferred=availableMicros>=10_000_000_000n&&slot===9?500:availableMicros>=500_000_000n?cycle[slot]:25;
  return [...PACK_TIERS].reverse().find(price=>price<=preferred&&tiers.includes(price)&&BigInt(price)*1_000_000n<=availableMicros&&(dailyRemainingMicros===null||BigInt(price)*1_000_000n<=dailyRemainingMicros))??null;
}
export const shortWallet = (wallet = "") => wallet.length > 12 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
