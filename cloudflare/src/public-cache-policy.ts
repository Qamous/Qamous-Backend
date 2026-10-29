const MINUTE = 60_000;
export const PUBLIC_STALE_MS = 7 * 24 * 60 * MINUTE;

// Every read checks the scoped content revision before and after loading. A
// successful edit/report invalidates a word immediately, independently of TTL.
// Unchanged dictionary entries need not spend D1/ledger quota every 15 minutes.
export function publicFreshMs(key:string):number {
  return /^word:[1-9]\d*$/.test(key) ? 24 * 60 * MINUTE : 15 * MINUTE;
}
