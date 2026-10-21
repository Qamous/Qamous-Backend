# Qamous security controls

Updated October 16, 2026. Applies to the Cloudflare runtime, not the retired Nest/AWS deployment.

## Resolved findings

1. **High — one-request bulk extraction.** Public `/users`, `/definitions`, `/word/search/all`
   and raw reaction exports are administrative only. They are not used by the frontend.
   Profile contribution reads require their owner. Public word pages, search and blog reads remain public.
2. **Medium — incomplete browser/cookie defenses.** API JSON responses are no-store/noindex,
   nosniff and non-embeddable. Cookie-authenticated writes require an approved Origin or Referer;
   cross-site Fetch Metadata is rejected. JSON endpoints reject simple form content types.
   Session storage keys are no longer returned to the browser. Changing a password revokes all
   old sessions and issues a fresh cookie to the current client. Account credential checks are throttled.
3. **Medium — insufficient read-abuse controls.** Public API reads are limited to 120 per IP
   per minute by SQLite-backed Durable Objects, independently of the zone's edge rules. Login,
   registration, reset, write and daily AI/email limits remain in force. Only a hash of each IP
   rate scope is stored, not its plaintext address. These controls can slow, not eliminate, distributed abuse.
4. **Medium — weak edge transport defaults.** Always Use HTTPS is on, minimum TLS is 1.2,
   origin certificate validation is Full (strict). TLS 1.0/1.1 rejection and 1.2/1.3 connections
   were tested. HTTP/3 stays off for the previously observed browser compatibility issue.
   HSTS remembers HTTPS for 180 days; subdomain inheritance and preload are off. Keep valid
   HTTPS available when changing hosting, since browsers retain this policy until it expires.

The zone's free AI-training block is enabled while AI search/user-directed agents remain allowed.
One free WAF rule blocks secret/legacy-admin probes. One free rate rule limits data/page bursts
to 60 per 10 seconds per IP, exempting **Cloudflare-verified** bots (not a spoofable User-Agent).
Both workers.dev mirrors and version-preview URLs are disabled so they cannot bypass the
zone's transport/bot controls or compete with the canonical site in search results.
The application-level limiter still applies to API reads by every client; Retry-After permits
well-behaved crawlers to back off. Expected live zone policy is recorded in `security/edge-policy.json`.

## Frontend and crawler controls

The sibling frontend sets a restrictive script policy without unsafe-inline/eval, denies framing,
restricts objects/forms/base URLs, and avoids referrer leakage of reset URLs. Its first-party inline
scripts were externalized. Inline **styles** remain allowed because the existing animation, icon,
tour and advertising components create styles at runtime. Known third-party script providers remain
explicitly allowed to preserve transliteration and advertising. They remain a supply-chain trust dependency.

Named model-training/dataset crawlers are disallowed in robots.txt. Google/Bing and required
rendering resources remain crawlable. API responses/private pages are noindex. Public word previews,
canonical/alternate URLs and a current sitemap are generated at authenticated deployment time from
public-only D1 fields; no account data or aggregate dataset file is deployed.

No robots policy or public-site rate limit guarantees that data cannot be copied. A determined
visitor can save public pages, distribute requests or spoof User-Agent strings. Preventing all
copying would require restricting the same content that search engines and visitors need.
Technical SEO does not guarantee indexing or higher rankings. Search Console submission was not performed.

SEO preview descriptions are build-time snapshots. The interactive page always reads current D1
content. Redeploy after important content/moderation changes to refresh previews and the sitemap.

## Operational safety

- Workers Free and no payment method were rechecked in the signed-in billing dashboard before release.
- No paid WAF/Bot Management plan, paid model fallback, R2, Vectorize or new subscription was enabled.
- Guarded deployment rejects configuration/account override arguments; only --dry-run is accepted.
- GitHub checks have read-only repository permission, pinned action SHAs and no production credentials.
- The frontend's retired Vercel deployment job was removed and Vercel Git auto-deploys disabled.
- Secrets, private imports/backups and generated public SEO input remain ignored. Never push them.
- Frontend dependencies were refreshed to patched compatible releases. Both runtime dependency audits
  and the full frontend dependency audit reported zero advisories at release; this is a point-in-time result.

## Verification

`npm run check`, `npm test`, and the local Workers integration suite cover CSRF, JSON-only writes,
bulk export denial, cross-account profile denial, read/login throttles, password-change session
revocation, legacy verification/reset/login, contributions and concurrent idempotent reactions.
Use a fresh **local-only** persistence directory for integration fixtures; do not mutate production.
Production data verification and recovery procedures are maintained with the private ingestion and
data operations tooling. This public runtime suite uses local-only fixtures.

The sibling frontend runs typecheck/build and tests for metadata escaping, canonical paths,
private-page indexing and script/crawler policy. `scripts/verify-release.mjs` checks public HTTPS,
headers, blocked bulk endpoints, crawlable routes and sitemap behavior without creating production users.

## References

- https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/
- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/ssl/edge-certificates/additional-options/minimum-tls/
- https://developers.google.com/search/docs/crawling-indexing/robots/intro
- https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers#google-extended
