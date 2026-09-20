# Free family playtest deployment

Initial hosting: September 19, 2026. Release workflow updated at the owner's request on September 20, 2026. One Node process serves the built Phaser client, HTTP endpoints and Colyseus WebSockets. Production remains in memory: sleep, restart, redeploy or suspension loses parties and scores.

Live service: **[kottabos.onrender.com](https://kottabos.onrender.com)**. Source: **[JacobHawkins/kottabos](https://github.com/JacobHawkins/kottabos)**, release branch `main`. Before this workflow change, the observed live revision was `6820902`, while GitHub main was `2c34a1f`; a GitHub push had not automatically updated Render. The existing GitHub integration, main branch and saved **After CI Checks Pass** setting were verified in Render on September 20. GitHub main protection was also applied successfully: required pull request, up-to-date passing `validate` from GitHub Actions, administrator enforcement, resolved conversations, and no force-pushes or deletion. See [verification.md](verification.md) and the [initial release pull request](https://github.com/JacobHawkins/kottabos/pull/1) for recorded checks and deployment evidence. Render's Deploys page shows the authoritative currently live revision.

This service was created through Render's dashboard. `render.yaml` records its intended configuration and is not an attached managed Blueprint. Configure the existing service in its dashboard as described below; do not create a second service or assume that pushing YAML changes its settings.

## Reviewed configuration

Use [render.yaml](../render.yaml) for one **Free** Node Web Service in Oregon, one instance, branch `main`, `autoDeployTrigger: checksPass`, `/api/health`, and the provider HTTPS subdomain. Keep the existing region and service. No database, disk, paid compute, test/preview service, custom domain, trial or keep-awake traffic is required. The owner's September 20 request supersedes the older manual-only deployment policy. [Render Blueprint fields](https://render.com/docs/blueprint-spec)

```powershell
npm ci --include=dev
npm run build
npm run start:prod
```

Render build: `npm ci --include=dev && npm run build`. Start: `npm run start:prod`. `.node-version` pins **24.21.0**. `PORT` is provided by Render; the process binds `0.0.0.0`. `RENDER_EXTERNAL_URL` supplies the allowed browser origin (or set `PUBLIC_ORIGIN` explicitly). The client uses its page origin; the pinned SDK converts HTTPS to WSS. Render terminates TLS and forwards HTTP/WebSockets to the same service port. See [Render WebSockets](https://render.com/docs/websocket), [web service setup](https://render.com/docs/web-services), [Node selection](https://render.com/docs/node-version), and [Vite's production guidance](https://vite.dev/guide/static-deploy.html).

Normal settings: `NODE_ENV=production`, `MAX_ROOMS=4`, `RECONNECT_SECONDS=120`, `COUNTDOWN_MS=3000`. Do not carry accelerated test timings into deployment. `HOST=127.0.0.1` is an optional local production override. No secrets go in the browser or repository. Test tooling is a build/dev dependency and is never loaded by the production entry.

Run the small authorized public smoke test from PowerShell (creates isolated test players and leaves afterward):

```powershell
$env:PLAYTEST_URL = 'https://kottabos.onrender.com'
npm run test:remote
Remove-Item Env:PLAYTEST_URL
```

## The $0 condition

Free instances idle after 15 minutes without inbound HTTP/WebSocket messages; waking typically takes about a minute. Workspaces share 750 Free instance hours per month. Hours exhaustion suspends Free services. Free compute does not cover arbitrary bandwidth/build usage. Without a payment method, bandwidth exhaustion suspends Free services and build exhaustion stops new builds; current artifacts can remain active. Restarts can occur at any time. [Render Free limits](https://render.com/docs/free)

Hobby currently includes **5 GB outbound bandwidth** shared by the workspace. HTTP assets and game WebSocket responses both count. With a payment method, overages can be billed; without one, services stop until the next period. [Bandwidth billing](https://render.com/docs/outbound-bandwidth)

Hobby Starter build pipelines include **500 minutes**. The pipeline spend limit only covers pipelines, not bandwidth. No payment method is the verified no-spend mechanism for this experiment; do not add one, upgrade, or enable paid trials. [Build pipeline](https://render.com/docs/build-pipeline), [billing FAQ](https://render.com/docs/faq)

Predeployment read-only account inspection found the approved Hobby workspace had **no card on file**, four existing suspended services, zero current Free hours/bandwidth/build minutes, and $0 current/projected charges. No other service or billing setting was changed. This is a point-in-time account observation, not a permanent guarantee if someone later changes billing. Keep account identifiers and billing screenshots out of this public repository.

The September 20 check before enabling automatic releases again found **no payment method and $0 charges**. Included usage was 2.4/750 Free instance hours, 10 MB/5 GB bandwidth and 1/500 build minutes. The same no-card safeguard and shared allowance thresholds remain in force.

Before later sessions, inspect workspace Billing → Monthly Included Usage and the game's Metrics page. Stop this experiment for the month at **80% of any included allowance** (600 hours, 4 GB, or 400 pipeline minutes), or sooner if unrelated services need the shared quota. This is a manual operational threshold; no polling job or paid monitoring service is installed. Stop playing with Leave Party and close game tabs so active gameplay heartbeats cease.

## GitHub and Render setup

The intended flow is `codex/test` → passing pull request into `main` → passing main CI → automatic Render deployment. These are separate checks: green development CI does not itself deploy, and a completed GitHub merge does not prove the Render build is live.

1. Keep `codex/test` as the development/testing branch and `main` as the production branch. No Render service tracks `codex/test`.
2. Enable [.github/workflows/ci.yml](../.github/workflows/ci.yml). It runs on pushes to both branches, pull requests targeting main, and manual dispatch. Its single required check is named **`validate`**.
3. Protect `main`: require a pull request, the `validate` status check, and an up-to-date branch before merging. Apply the rule to administrators too; do not allow force-pushes, deletion or bypasses. The owner can merge their own tested pull request; a second person's approval is not required by this workflow.
4. In the existing Render service, confirm the linked repository is `JacobHawkins/kottabos`, branch is `main`, and Auto-Deploy is **After CI Checks Pass**. A connected GitHub provider is required: services configured only with a public repository URL cannot auto-deploy. Preserve Free compute, one instance, environment settings, no card and shared usage limits. [Render auto-deploy and CI integration](https://render.com/docs/deploys)
5. Verify the full path with the release: a passing `validate` check on the merged main revision, a successful Render deployment of that same revision, and a working public game. Record the evidence in [verification.md](verification.md).

CI uses `.node-version`, `npm ci`, syntax checks, focused rule/session tests, twelve-player acceptance, real Chrome/Edge browser tests, a production build and production acceptance. The production browser test verifies the bundled character sheet and its credits download. The 20-minute job runs on a standard Ubuntu runner, has read-only repository permissions, and cancels older runs for the same ref. It uploads no artifacts, creates no persistent caches, uses no deployment secrets and provisions no services. Standard GitHub-hosted runners are free for public repositories; recheck billing before changing repository visibility or runner type. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

Keep `validate` unconditional and do not add path filters that prevent it from running on a release. Render waits when no checks exist or a check fails, but accepts skipped/neutral check conclusions as well as success. Preserve the real test steps rather than skipping them to release. The actual deployed revision is authoritative when a build fails or is canceled.

## Release, recover and stop

1. Develop and test on `codex/test`, commit/push it, and inspect its CI results. Open a pull request into main and fix any failing checks on the test branch.
2. Merge the passing pull request when ready to release, between play sessions. The main commit runs CI again, then Render builds and deploys it. Do not use Manual Deploy for routine releases; deployments end existing parties.
3. Check Render Events/Logs and the HTTPS game. Verify assets, WSS, two-player joining, results/replay and recovery; record the actual revision. Never paste reconnection credentials into logs or reports.
4. Merge the latest `origin/main` back into `codex/test` before the next development change, keeping it aligned with released changes.
5. If a release is bad, use Render's Rollback for an earlier successful deployment, then prepare the fix or revert through `codex/test` and a tested main pull request. Check the Auto-Deploy setting afterward: rollback or deploying a specific commit can disable it. Restore **After CI Checks Pass** when the intended main revision is ready. Recheck the round/recovery loop.
6. Monitor Metrics and Billing under the $0 rules above. To stop reversibly, use the existing service's Suspend control; resume deliberately. Do not delete/recreate the service or alter unrelated services.

## Public protections and limits

The pilot caps total rooms at four and each room at twelve reserved/connected players. The resulting 48-seat process ceiling is a configured bound, not measured concurrent capacity; twelve-client acceptance covers one party. HTTP budgets per direct socket peer per minute: 12 create requests, 240 other matchmaking/leave requests, 240 party lookups; 240 WebSocket upgrades. A family sharing a network fits comfortably. Proxy peers may share budgets too; arbitrary forwarded IP headers cannot bypass them. The limiter holds at most 2,048 live buckets. These are bounded pilot safeguards, not a general DDoS service.

HTTP JSON and WebSocket messages are capped at 4 KiB. Colyseus also bounds connection messages, while game input has its own sequence/rate/queue/age validation. Browser HTTP and WebSocket origins must match the configured public origin. Originless native SDK/health requests are allowed and remain rate-limited where relevant. Short party codes are invitations, not strong private access control.

Only `/`, `/assets/*`, `/robots.txt`, intended API endpoints, and Colyseus routes are exposed. Unknown API/source/test/dotfile paths return errors rather than the application HTML. No development middleware or source maps are served. A new structural deployment or scale-out design requires new work; do not increase instances with this in-memory design.
