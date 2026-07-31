# Review-bait fixture

Disposable test fixture for verifying the DevDigest findings-counter UI
(hover preview on the PR list, clickable severity badges on the Agent runs
tab, in-diff severity markers on the Files changed tab). Every file here
contains a deliberately planted issue spanning multiple severities so a
review run produces real, varied findings to click through.

**Not real code — do not import from `qa/**` anywhere, and close this PR
without merging once verification is done.**

| File | Planted issue | Expected severity |
|---|---|---|
| `config.ts` | hardcoded live-looking Stripe key | CRITICAL / security |
| `webhook-forwarder.ts` | untrusted `callback_url` forwarded with a live secret attached (SSRF-shaped) | CRITICAL / security |
| `user-posts.ts` | N+1 query — one `posts.findMany` per user in a loop | WARNING / perf |
| `ratelimit.ts` | 429 response has no `Retry-After` header | SUGGESTION |
