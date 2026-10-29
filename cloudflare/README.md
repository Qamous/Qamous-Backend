# Qamous Cloudflare API

This directory contains the public Cloudflare Worker API for Qamous. The private vocabulary ingestion service and its data operations are maintained separately.

## Develop

1. Install dependencies with npm ci.
2. Run npm run dev to start a local Worker. Local requests use only local bindings.
3. Run npm run check, npm test, and npm run test:integration before an API change.
4. Deploy with npm run deploy. The deploy script validates the configured account, database, quota limits, and allowed bindings.

Production API: https://api.qamous.org. Public website: https://qamous.org.

See SECURITY.md for runtime protections and the edge policy.

## Search discovery

Apply `migrations/0008_seo_discovery.sql` before deploying the SEO API and
frontend. The migration creates a small registry of occupied 1,000-word ID
ranges. Triggers keep it current as future imports and deletions run. The web
Worker serves a sitemap index and bounded word shards from public, moderation
eligible definitions. `/seo/browse/:language` uses an indexed keyset cursor to
expose every eligible word through ordinary alphabetical links without static
word files. The API's SEO JSON remains `noindex`; the web Worker renders HTML
and XML. Public word payloads remain fresh for 24 hours while their scoped
content revision is unchanged. Every API read checks that revision; edits and
moderation invalidate it immediately. Other public payloads retain their
15-minute refresh interval, and the web Worker's HTML cache lasts 60 seconds.

Set the same high-entropy `SEO_INTERNAL_SECRET` with `wrangler secret put` on
both `qamous-web` and `qamous-api`. The website passes it only to SEO API reads
through its service binding. Those reads bypass the API's per-IP read limit so
large sitemap crawls do not make word pages unavailable; direct public API
requests retain the limit. Rotate the two secrets together.

Run `npm run check` and `npm test`, then use the frontend's
`node cloudflare/verify-seo.mjs` and `node cloudflare/audit-sitemap.mjs` against
production. Google Search Console must separately confirm sitemap processing,
indexing, and traffic.
