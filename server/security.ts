export const CONNECTION_LIMITS = { total: 500, perIp: 20, perWallet: 3 };

export function originAllowed(method: string, origin: string | undefined, fetchSite: string | undefined, appOrigin: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  return fetchSite !== 'cross-site' && (!origin || origin === appOrigin);
}

/** Use the quickest observed round trip; delaying later ACKs cannot increase credit. */
export function latencyCredit(rtts: number[], floor = Infinity) {
  const valid = rtts.filter(x => Number.isFinite(x) && x >= 0);
  return valid.length ? Math.min(150, floor, ...valid) : 0;
}
