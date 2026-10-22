# Public reads and D1 quota protection

The application reserves database work in one persistent SQLite Durable Object
before submitting SQL. This accounting does not depend on delayed Cloudflare
analytics or on a visitor's IP address, cookie, user agent or claimed bot name.

| Scope | Daily rows read |
| --- | ---: |
| Imports and routine maintenance pause | 3,500,000 |
| Public traffic and automated work stop taking new reads | 4,500,000 |
| Authenticated essential operations stop | 4,900,000 |
| Unallocated safety within the 5,000,000 allowance | 100,000 |

The 500,000 reserve consists of up to 400,000 essential reads and 100,000 safety
reads. Authentication and an authenticated mutation can use the essential tier;
Google and other crawlers cannot. A minute permits at most 250,000 reserved
public/import reads, with 50,000 additional essential reads. Four public/import
operations and six total operations can be in flight; imports get one slot.
The final UTC minute admits no new work. Daily scope resets at midnight UTC.

All API, runtime and hosted-importer D1 paths use a closed facade, including
reads performed by writes, transactions and sessions. Successful results settle
against D1's actual `meta.rows_read`. Missing results retain their reservation.
An observed cost above the reservation opens the day's circuit. Shared cache
reads remain available while fresh D1 work is denied. A new installation needs
an explicit current-day baseline; the October 22 deployment starts closed
because that day's allowance was already exhausted.

## Limits of the guarantee

Pre-admission reservations and global concurrency are strict. A reservation is
not a database execution limit: D1 supplies the true scan cost after execution.
Reviewed indexed writes have explicit conservative cost contracts. General SQL
uses a 50,000-row reservation; a future query-plan or dataset-size change can
exceed it once and trip the circuit. SQL `LIMIT` alone is never treated as a scan
bound. Review and rehearse changed queries against growth fixtures before a
release. Direct administrator dashboard/REST/Wrangler SQL bypasses application
admission and must not be used for routine jobs. This system does not impose a
provider-level hard cap on arbitrary administrator SQL or unknown query costs.

Use `node scripts/guarded-d1.mjs --file reviewed.sql --reserve 200000` for
reviewed, bounded maintenance. Read the result before retrying a failed write:
a lost acknowledgement may conceal a committed transaction. Public content
changes require cache invalidation; prefer the application mutation routes.

## Public cache and search

One Durable Object per resource coalesces concurrent misses across locations.
Words, 100-definition card buckets, language-specific feed candidates, country
related links, countries, blog posts, source lists, sitemap shards and browse
pages share public data. Personal reaction flags are overlaid separately and
are never stored in these entries. The home feed shuffles the cached candidate
pool for each visit, retaining its established weighted random behavior.

Entries are fresh for 15 minutes and may serve their existing generation for
up to 24 hours if a refresh is denied. A negative result lasts only five minutes
and has no longer stale fallback. Moderation and published-text mutations start
a durable barrier after budget admission and immediately before the SQL write.
Pending or uncertain mutations block old snapshots; completion or lease expiry
advances the generation. A denied mutation does not invalidate the cache.
Public HTML lasts at most 60 seconds. Explicit session cookies remain private;
analytics cookies do not create avoidable cache misses.

If an existing session cannot be checked because the read guard is closed,
cached public GET routes still return public content without personal reaction
flags. The session cookie is retained. Account endpoints and mutations continue
to return a temporary failure instead of assuming an authenticated identity.

Google receives the same rendered content as visitors. Preserve the verified
bot exemption in the zone's existing per-IP rule; do not add a user-agent budget
bypass or a broad browser challenge. Canonical word/browse/dialect pages and
assets remain crawlable. Faceted search URLs are excluded from crawling.
Temporary uncached overloads return `503` with `Retry-After`, without `noindex`.
Do not request indexing or resubmit sitemaps while public pages are unavailable.
Google removed its crawl-rate slider and does not support `Crawl-delay`.

## Status, alerts and recovery

The existing private importer credential authorizes `GET /read-budget` and
`POST /read-budget/reconcile` with `{day, rowsRead, observedAt}`. Reconciliation
accepts only a fresh current-day observation, moves accounting upward, and
cannot reopen a spent budget. Status includes route costs, denials and unknown
results without recording SQL values, cookies or search text. Daily threshold,
cost-overrun and bounded denial logs are retained with full sampling.

During the October 22 outage, a fresh D1 export provided recovery data while
normal queries were unavailable. Raw exports and credentials remain under
ignored `private/` paths. `scripts/build-public-cache-snapshot.mjs` projects
only public payloads with current moderation, meanings, examples and credits;
it removes account fields before projecting. `scripts/seed-public-cache.mjs`
validates hashes and payloads and seeds at one explicitly supplied revision.
Never seed an old export after a content mutation. For a future live export,
capture the cache revision before exporting and stop if it changes. Today the
already-exhausted read budget prevents intervening application writes.

The seed endpoint is authenticated, size limited, refuses private fields and
true personal reaction flags, and rejects a changed generation. It executes no
D1 SQL. The recovery snapshot does not restore logins or writes before the
provider quota resets. Local regression checks replay 987 distributed requests,
concurrent misses, unavailable coordinators, rollover, reservation failures,
moderation generations, large bilingual contributions and account deletion.
