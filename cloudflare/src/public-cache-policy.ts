const MINUTE = 60_000;
export const PUBLIC_STALE_MS = 7 * 24 * 60 * MINUTE;

// Every read checks the scoped content revision before and after loading. A
// successful edit/report invalidates a word immediately, independently of TTL.
// Unchanged dictionary entries, country data, related words and sitemap resources need not spend D1/ledger
// quota every 15 minutes. Their scoped mutation selectors still invalidate
// edits, moderation and newly imported words immediately.
export function publicFreshMs(key:string):number {
  return /^(?:word:[1-9]\d*|countries|related:[A-Z]{2}:(?:ar|franco)|seo-shard:\d+|seo-index)$/.test(key) ? 24 * 60 * MINUTE : 15 * MINUTE;
}
