# Public reads and D1 quota protection

## October 23 recovery pause

The October 23 outage exhausted Durable Object SQLite writes, a separate quota
from D1 reads. Incident analytics attributed 94,434 rows written to `READ_BUDGET`,
9,443 to `PUBLIC_CACHE`, and 572 to `RUNTIME`. The previous read-budget ledger
normally changed four rows when reserving D1 work and four when settling it,
before index overhead. A rejected reservation also changed two denial counters;
retries amplified that cost. The accounting guard was the main writer.

`PUBLIC_READ_ONLY=true` stops dynamic API requests before session loading,
database admission, rate counters or cache coordination. Only root metadata and
robots responses remain available directly from the API. The frontend serves
the fresh, public-only published snapshot; account features and changes receive
`503` with `Retry-After`. The importer uses the same early pause, and its checked-in
and live cron schedules must both be empty. Deployment checks enforce these
settings without requiring a working Durable Object status call.

The pause does not expire at midnight. Production uses an explicitly frozen
snapshot while both writers stay paused; it does not create another outage when
the export's ordinary 24-hour expiry passes. A snapshot deployed without frozen
mode must fail closed at its expiry. Keep writes and imports paused while either
snapshot mode is authoritative. Reopening writes requires removing the snapshot
from the frontend deployment, including its public assets, before unpausing the
API and importer. This prevents removed or moderated content surviving in a
public asset. Do not extend a non-frozen snapshot's lifetime by changing metadata.
The API deployment script checks live `qamous-web` settings before allowing
`PUBLIC_READ_ONLY=false` and refuses while `PUBLIC_SNAPSHOT_ID` is present.
Removing snapshot authority must precede reopening writes; an unavailable or
malformed settings response cannot authorize an unpause. Deploying the paused
configuration makes no additional settings request.

The recovery snapshot `0c98a1c842bfa1fa` came from a fresh production export
completed at `2026-10-23T13:30:26.182Z`, after the API and importer freeze.
Its 4,693 public resources cover 4,312 visible word aliases and 5,966 visible
definitions, plus discovery, source credits, licenses and public contributor
profiles. The deployment copies only audited public JSON. Raw SQL exports,
account credentials and internal recovery evidence remain in ignored storage.
The frontend renders and serves this snapshot without API, D1 or Durable Object
calls. Missing or invalid snapshot data fails closed without a dynamic fallback.

Public API rate limiting now uses the native Workers RateLimit binding at 120
requests per minute per hashed client IP. It writes no application Durable Object
rows and has no persistent-counter fallback. These native limits are approximate
and per Cloudflare location; they do not replace strict database admission.
Authenticated write and authentication limits remain independently enforced.
Direct static asset requests avoid both Durable Objects and Worker invocation
quotas; rendering HTML in a Worker still consumes the Worker request allowance.

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

A scope/claim refusal before SQL submission settles at zero database rows.
Once SQL is submitted, an unknown result retains its full reservation.

## Protecting the ledger's storage allowance

An independent, persistent daily operation counter bounds the ledger's own work.
Imports stop when the shared counter reaches 1,000, public operations at 1,500,
and essential operations at 2,000. Successful admissions consume a unit even
when D1 reports zero reads or the caller fails before submitting SQL. The policy
allocates 32 conservative SQLite row-write units per operation: at most 64,000
allocated units for that ledger per day, leaving room within the account's
100,000-row allowance for other namespaces and overhead. This is a conservative
application allocation, not Cloudflare's provider-wide billing counter.
Local Workers-runtime measurements observed 17 written rows for reserve, unknown
result and final settlement; the fixture including old-row cleanup and both
threshold alerts used 23. A 2,000-operation run used 24,004 written rows, and
1,000 subsequent denials wrote zero. Recheck these measurements when changing
the ledger schema or lifecycle.

Denied reservations do not write per-attempt counters, expire leases or clean up
history. The first valid reservation after UTC rollover may insert one durable
day row carrying unresolved reservations, even when that request is refused.
Persisting this carry prevents repeated refusals from rescanning yesterday's
leases after an object restarts. With 1,500 historical unresolved leases, 1,000
rollover refusals used 2,501 rows read and two rows written; another 1,000 refusals
from newly constructed ledger instances used 1,000 reads and zero writes.
Read-only status previews memoize their conservative carry until a meaningful
mutation, while persisted current-day counters always take precedence.
Repeated unknown settlements and status calls remain read only. Denial counts
and log throttles are volatile; they reset when the object restarts. Admitted
operations remove at most one old row from each ledger table. A settlement from a previous
UTC day must consume a new operation unit before updating stored accounting;
when refused, it retains its original D1 reservation. Existing query totals
initialize the new counter so deploying this protection cannot reset usage.

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
a durable, resource-specific barrier after budget admission and immediately
before the SQL write. Word changes cover the old and new canonical spelling
groups, their definition-card buckets, and affected discovery/sitemap resources.
Blog changes cover posts only. Pending or uncertain mutations block only those
resources; completion or lease expiry advances only their generations. An
unrelated cached word stays available when public D1 reads are paused. A denied
mutation does not invalidate the cache. Existing seeded records retain their
generation until a matching mutation touches them.

Active word claims reject a competing mutation touching the same word group;
different words may still be edited concurrently even when their discovery
collections overlap. An unknown write retains its claims through lease expiry.
This prevents a concurrent rename from moving a pending deletion's content into
an unprotected group. Renames also compare the previously read spelling/name
in the SQL update and return a retryable conflict when it changed meanwhile.

After a confirmed write, at most four word entries plus changed countries/posts
may be rebuilt through the essential allowance. A refresh captures its resource
versions before reading D1 and publishes only if no intervening mutation changed
them. If that refresh is denied, only affected entries await a later refresh;
removed content never falls back to its old generation. Discovery collections
can temporarily be unavailable when their own necessary refresh is denied.
Public HTML lasts at most 60 seconds. Explicit session cookies remain private;
analytics cookies do not create avoidable cache misses.

If an existing session cannot be checked because the read guard is closed,
cached public GET routes still return public content without personal reaction
flags. The session cookie is retained. Account endpoints and mutations continue
to return a temporary failure instead of assuming an authenticated identity.

Google receives the same rendered content as visitors and remains allowed by
`robots.txt`. The zone burst rule permits 60 matching page/data GET requests per
10 seconds per client IP and Cloudflare location, then throttles excess requests.
It applies to all clients and crawlers, including verified bots; there is no broad
verified-bot exemption or browser challenge. These WAF decisions execute before
the Worker and use no application Durable Objects. Ahrefs is blocked by its
separate zone rule before Worker execution. Do not add a user-agent budget bypass.
Canonical word/browse/dialect pages and assets remain crawlable. Faceted search
URLs are excluded from crawling.
Temporary uncached overloads return `503` with `Retry-After`, without `noindex`.
Do not request indexing or resubmit sitemaps while public pages are unavailable.
Google removed its crawl-rate slider and does not support `Crawl-delay`.

## Status, alerts and recovery

The existing private importer credential authorizes `GET /read-budget` and
`POST /read-budget/reconcile` with `{day, rowsRead, observedAt}`. Reconciliation
accepts only a fresh current-day observation, moves accounting upward, and
cannot reopen a spent budget. Status includes route costs, operation counts and
unknown results without recording SQL values, cookies or search text. Denial
counts are process-local. Daily threshold, cost-overrun and bounded denial logs
are retained with full sampling.

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
true personal reaction flags, and rejects a changed export stamp or an active
mutation. It stores each resource under its current individual generation. It executes no
D1 SQL. The recovery snapshot does not restore logins or writes before the
provider quota resets. Local regression checks replay 987 distributed requests,
concurrent misses, unavailable coordinators, rollover, reservation failures,
moderation generations, large bilingual contributions and account deletion.

Durable Object requests, duration and storage have separate
[Free limits](https://developers.cloudflare.com/durable-objects/platform/pricing/).
The ledger's operation cap does not impose an account-wide cap on other
namespaces, administrator actions or request/duration usage. Denied RPC calls
still consume the separate Durable Object request allowance. Scoped cache checks use
indexed, read-only queries unless a mutation lease actually expires, and the
word SSR endpoint batches its optional discovery snapshot checks. This release
does not claim to eliminate every Cloudflare quota or public-traffic outage.
