# Qamous Cloudflare API

This directory contains the public Cloudflare Worker API for Qamous. The private vocabulary ingestion service and its data operations are maintained separately.

## Develop

1. Install dependencies with npm ci.
2. Run npm run dev to start a local Worker. Local requests use only local bindings.
3. Run npm run check, npm test, and npm run test:integration before an API change.
4. Deploy with npm run deploy. The deploy script validates the configured account, database, quota limits, and allowed bindings.

Production API: https://api.qamous.org. Public website: https://qamous.org.

See SECURITY.md for runtime protections and the edge policy.
