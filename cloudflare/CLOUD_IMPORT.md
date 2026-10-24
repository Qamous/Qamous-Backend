# Hosted vocabulary import

The private qamous-import Worker continues the approved collection on Workers Free. Its one-minute cron uses the existing Qamous D1 binding and the existing QamousImportState SQLite Durable Object namespace. Batch SQL, checkpoints, retries, source fingerprints, definition provenance, votes/points auditing and deletion of consumed pages are retained. No data is re-uploaded by a code deployment. The Windows import task is disabled following verified cloud handoff.

## Late catch-up

The normal 75,000 import-write and 80,000 account-write ceilings stay in place. From **22:00 to 23:55 UTC**, both ceilings become **95,000 measured writes**. This is 6–7:55 p.m. New York during daylight saving time, and 5–6:55 p.m. during standard time. The account limit includes other D1 workloads, not just this dictionary.

The existing **10,000-write in-flight reservation stays unchanged** in both windows. The 95k target is a ceiling, not an exact fill: another packet runs only if its full reservation fits. With ordinary small packets this can stop around 85k, leaving room for an unexpectedly large search-index/FTS write burst. The importer does not reduce this margin merely because the site has few users. Read, database-size and integrity guards also remain enforced.

A daytime quota hold now wakes at 22:00 UTC instead of sleeping through the entire catch-up window. Existing checkpoints that were already waiting until the next day are advanced to that same-day opportunity without changing their cursor or counts. Network/auth retries, uncertain in-flight writes, integrity holds and final-audit waits are not brought forward. Writes still stop at 23:55 UTC, and the next day's normal import starts no earlier than 00:15 UTC.

## Monitoring and deployment

Before starting a packet, the importer checks both provider usage and remaining
shared ledger capacity. Ordinary quota waits resume automatically at the next
eligible window. A one-time accounting-policy upgrade can reassess an old quota
hold, but never clears an uncertain in-flight transaction or integrity halt.

A proven refusal before SQL submission clears its in-flight marker without
charging 10,000 nonexistent writes. A successful batch persists its measured
cost and receipt before identity or integrity checks can fail; replay does not
charge that receipt twice. Lost SQL acknowledgements still retain the full
conservative reservation. No source rows, future-language fields, examples or
provenance are discarded to reduce cost.

From this directory, run `node scripts/cloud-import-status.mjs`. Check `lastScheduledAt`, `lastSuccessAt`, `cursor`, `nextAttemptAt`, `quotaPolicy`, and `staging.consumedPagesDeleted`. Status is authenticated and local credentials stay under ignored `private/cloud-import/`; do not publish that folder.

For a reviewed code update, first verify Workers Free Active in the signed-in account dashboard and save genuine evidence in `private/billing-proof.json`. Then run `node scripts/deploy-import-cloud.mjs --deploy`. The helper enforces the existing account/database/namespace/job/cron identities and refuses additional resource bindings. It records the prior version and checkpoint, performs a dry run, preserves existing Worker secrets, and verifies cursor, record-count and cleanup continuity afterward. It never stages new vocabulary or applies schema migrations.

If the local monitoring credential was lost, `--recover-monitor` replaces only IMPORT_ADMIN_TOKEN with an equivalent credential in the same access-restricted local folder. CLOUDFLARE_READ_TOKEN remains encrypted in the Worker. Do not run it when a working local credential exists.

To pause publication, remove the Worker's cron and wait for an active lease to finish. Keep the laptop publisher disabled. Roll back code with the version recorded privately before deployment; never overwrite the durable checkpoint or restore an old whole database over later member contributions. Source and batch removals require a fresh backup and a targeted provenance-aware removal rehearsal.

The hosted sources were recovered byte-for-byte from the deployed Worker's source map before this change. They are now versioned with the quota update so future updates do not depend on untracked local files. The deployment record and immutable job are preserved separately in private storage.

Validation: `npm test`; `npm run check`; `node test/import-host.integration.mjs`. The catch-up tests cover UTC boundaries, quota headroom, maintenance reservations, legacy wait-state migration, unaffected retry delays, interrupted-run charging and idempotent completion. The local workerd integration verifies atomic D1 transactions and deletion of consumed pages while preserving the source ledger and contribution points.

[D1 quota and reset rules](https://developers.cloudflare.com/d1/platform/pricing/) · [Cloudflare importer logs](https://dash.cloudflare.com/39292a971f28b413619657e9f2c77003/workers/services/view/qamous-import/production/observability/events)
