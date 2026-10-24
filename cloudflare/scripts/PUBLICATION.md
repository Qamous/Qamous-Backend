# Publishing public dictionary data

Public browsing stays on static assets. These commands do not enable writes,
resume imports, schedule exports, or make public requests fall back to D1.

## Prepared cards and feed maintenance

Migration `0009_prepared_public_cards.sql` adds the derived
`public_card_payloads` and `public_feed_candidates` tables. The existing words,
definitions, examples, pronunciation and provenance tables remain authoritative.
Source-table triggers discard affected prepared payloads in the same transaction;
the feed projection tracks the visible representative cards and vote weights.
Public GET requests never populate prepared payloads by writing to D1.

Apply migration 0009 only through the reviewed, admitted maintenance procedure,
while the API and importer have `PUBLIC_READ_ONLY=true` and importer schedules
are empty. The protected importer endpoint
`POST /prepared-cards/maintenance-budget` admits only operation
`migration-0009`, reserves a fixed conservative 250,000 reads from the essential
allowance, and does not itself execute SQL. Retain the admitted reservation's
identity in the private maintenance report; do not submit an untracked migration
directly or refund its charge without measured results. The current tool retains
the entire migration charge because Wrangler does not return complete cost data.

`PUBLIC_CARD_PAYLOADS=true` selects prepared card/feed reads only after the
migration exists. It is independent of `PUBLIC_READ_ONLY`: enabling the read
model does not resume authentication, contributions, voting or imports. Keep
both writer pauses enabled throughout migration, seeding and verification.

Backfill uses the protected `POST /prepared-cards/seed` endpoint, accepts at most
50 already-reviewed public card payloads per request, and remains in the
essential read budget. Each payload is validated for private fields and personal
reaction flags before storage. Seed from a reviewed current projection, not raw
import records or a private SQL export. The protected
`GET /prepared-cards/status` reports prepared/eligible cards, feed candidates and
missing payloads. Verify `missingPayloads=0` before considering backfill complete.
Never expose importer credentials in command arguments, output or public files.

Run the reviewed maintenance tool from the backend `cloudflare/` directory:

```powershell
node scripts/prepared-cards-maintenance.mjs migrate
# After migration completes, wait at least 60 seconds for its admission lease.
node scripts/prepared-cards-maintenance.mjs seed <absolute-sanitized-public-manifest.json>
```

First deploy the reviewed API/importer code with the prepared-card flag enabled
and both writer pauses retained. `migrate` refuses any pending migration list
other than exactly `0009_prepared_public_cards.sql`; it retains its conservative
250,000-read reservation. The tool verifies the Free plan, existing private
maintenance credentials, both live writer pauses, the approved database and an
empty live importer schedule. Do not change these checks to bypass a refusal.

The seed input is the sanitized packaged public `manifest.json` (schema version
1), with `cards:<bucket>`, `feed:0` and `feed:1` resources. The original export
must have completed within two hours. Its export, generation and expiry times,
public-definition count, resource byte counts, filenames and SHA-256 hashes
must pass auditing. Every payload is checked for private fields before the first
seed request. A recently rebuilt projection cannot renew an old export's age.
Never edit timestamps or rebuild older SQL merely to renew a build time.
Seeding is sequential, with CLI batches bounded to both 10 cards and 160 KB. It
compares database/snapshot counts before submitting and requires matching
prepared/eligible/snapshot card counts, matching feed counts and zero missing
payloads afterward. Reports are written under
`cloudflare/private/cloud-import/prepared-card-migration.json` and
`prepared-card-seed.json`. There is no automatic retry, unpause or scheduler.
An admission-specific `prepared-card-migration-<id>.json` is saved before any
remote SQL and updated before submission, so an interrupted migration retains
its reservation identity and uncertain-outcome evidence.

The CLI submits at most 10 cards and 160 KB per request, below the server's hard
limits, and closes each maintenance HTTP connection. A transport failure stops
the run without an automatic retry. Inspect authenticated status and confirm
writers are still paused before restarting against the same audited snapshot;
identical already-prepared payloads are not rewritten.

The frozen frontend continues serving its own reviewed static snapshot during
this work; prepared-table maintenance cannot make an old snapshot current.
Publishing new content still requires the static release procedure below.

## Static release procedure

1. Keep the API and importer paused and importer schedules empty. Obtain a
   current consolidated private SQL export through the admitted recovery-export
   procedure. Keep its original metadata (database ID, byte count, SHA-256 and
   export start/completion timestamps). Never change timestamps to reuse an old
   export. Exporting is a separate, budgeted operation, not part of this command.
2. Prepare and audit the public release offline, using new directories:

   ```powershell
   node cloudflare/scripts/prepare-public-release.mjs --dictionary cloudflare/private/current/private.sql --metadata cloudflare/private/current/export-metadata.json --work cloudflare/private/release-work-new --output cloudflare/private/release-public-new
   ```

   This verifies the source digest and two-hour freshness, generates all public
   projections, checks visibility/coverage and private account values, and
   publishes the sanitized output directory only when every check passes. Raw
   SQL, credentials, private source paths and validation reports are not copied.
3. From the sibling frontend checkout, inspect the release without changing it:

   ```powershell
   node scripts/publish-public-data.mjs --source <absolute-reviewed-public-directory> --validate-only
   ```

4. After reviewing the prepared release and source changes, publish it:

   ```powershell
   node scripts/publish-public-data.mjs --source <absolute-reviewed-public-directory>
   ```

   The frontend command creates an isolated staging checkout, installs the
   snapshot there, builds, verifies SSR, runs guarded deployment preflight, then
   deploys. Existing Free-plan and live paused-writer guards remain mandatory.
   It verifies the deployed snapshot ID and homepage/robots/sitemap before
   updating the original checkout's snapshot configuration. Build/preflight
   failures leave both production and the original configuration untouched.
   A failure after deployment is reported as a verification failure; it does
   not automatically roll production back to potentially withdrawn content.

Commit the resulting `wrangler.jsonc` and `cloudflare/public-snapshot-release.json`
in the frontend to record the release. Generated assets remain ignored and must
be retained locally for subsequent full builds. Private work directories remain
private. Contributor authentication and mutable public-content publication need
their own coordinated protocol before the writer pause can be lifted.

## Validation checkpoint

The optimization validation checkpoint passed 199 backend tests and 145 frontend
tests. The frontend full production build, Worker TypeScript check and SSR
verification also passed (24 routes, 12 concurrent isolated renders, no duplicate
word calls). These are local verification results, not a production load test or
a statement that future quota exhaustion is impossible.

Before a later release, rerun the backend suite from `cloudflare/` (`npm test`),
the frontend suite (`npx vitest run`), production build (`npm run build`),
SSR verification (`npm run test:ssr`) and Worker check
(`npx tsc -p cloudflare/tsconfig.json`). Repeat privacy/coverage auditing for each
new export; passing application tests does not approve different public data.
