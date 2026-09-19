# Free family playtest deployment

Implementation/research date: September 19, 2026. One Node process serves the built Phaser client, HTTP endpoints and Colyseus WebSockets. Production remains in memory: sleep, restart, redeploy or suspension loses parties and scores.

Live service: **[kottabos.onrender.com](https://kottabos.onrender.com)**. Source: **[JacobHawkins/kottabos](https://github.com/JacobHawkins/kottabos)**, `main`. Initial application revision: `b66814ebca7ed1daf83519bd8622fd1e471d6774`. This service was created through Render's dashboard using the public repository and the settings below; `render.yaml` is the reproducible equivalent, not an attached managed Blueprint. Do not apply it as a second service.

## Reviewed configuration

Use [render.yaml](../render.yaml) for one **Free** Node Web Service, one instance, manual deploys, `/api/health`, and the provider HTTPS subdomain. Oregon is the proposed western-US region; choose the closest supported region to the group before creation (the region cannot be changed in place). No database, disk, paid compute, preview service, custom domain, trial or keep-awake traffic is required. The repository/branch containing the Blueprint supplies the source; confirm the selected branch in the creation screen.

```powershell
npm ci --include=dev
npm run build
npm run start:prod
```

Render build: `npm ci --include=dev && npm run build`. Start: `npm run start:prod`. `.node-version` pins **24.21.0**. `PORT` is provided by Render; the process binds `0.0.0.0`. `RENDER_EXTERNAL_URL` supplies the allowed browser origin (or set `PUBLIC_ORIGIN` explicitly). The client uses its page origin; the pinned SDK converts HTTPS to WSS. Render terminates TLS and forwards HTTP/WebSockets to the same service port. See [Render WebSockets](https://render.com/docs/websocket), [web service setup](https://render.com/docs/web-services), [Node selection](https://render.com/docs/node-version), and [Vite's production guidance](https://vite.dev/guide/static-deploy.html).

Normal settings: `NODE_ENV=production`, `MAX_ROOMS=4`, `RECONNECT_SECONDS=120`, `COUNTDOWN_MS=3000`, `ROUND_DURATION_MS=45000`. Do not carry accelerated test timings into deployment. `HOST=127.0.0.1` is an optional local production override. No secrets go in the browser or repository. Test tooling is a build/dev dependency and is never loaded by the production entry.

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

Before later sessions, inspect workspace Billing → Monthly Included Usage and the game's Metrics page. Stop this experiment for the month at **80% of any included allowance** (600 hours, 4 GB, or 400 pipeline minutes), or sooner if unrelated services need the shared quota. This is a manual operational threshold; no polling job or paid monitoring service is installed. Stop playing with Leave Party and close game tabs so active gameplay heartbeats cease.

## Create, update and stop

1. Confirm the account/workspace, source repository/branch, region, no payment method, and shared usage. If the host demands a card, stop; do not accept a paid fallback.
2. New → Web Service, select the authorized source. Choose Node and **Free**, then enter the build/start/health/environment settings above. Disable auto-deploys. Review the final screen before creation. Public source is allowed for this project by the owner; a public repo alone does not deploy it.
3. Check build logs and the service's HTTPS URL. Verify assets load, game sockets use WSS, two isolated players can join, finish/replay, and recover. Record the live revision and URL in `docs/verification.md`.
4. For an update, run the local checks, commit/push, then use service → Manual Deploy → Deploy latest commit between play sessions. Auto-deploys remain off. The deployment ends existing parties.
5. Inspect service Logs and Events for startup/deploy failures; do not paste reconnection credentials. Use Metrics for bandwidth and workspace Billing for aggregate usage and builds.
6. If a release is bad, choose an earlier successful deploy in Events and use Rollback. Free services retain only the two most recent prior deploys; keep Git history too. Recheck the round/recovery loop afterward.
7. Stop the playtest with the service's Suspend control in Settings. Resume only deliberately. Deleting the service permanently removes its configuration; suspend for a reversible stop. No other services need to change.

## Public protections and limits

The pilot caps total rooms at four and each room at twelve reserved/connected players. The resulting 48-seat process ceiling is a configured bound, not measured concurrent capacity; twelve-client acceptance covers one party. HTTP budgets per direct socket peer per minute: 12 create requests, 240 other matchmaking/leave requests, 240 party lookups; 240 WebSocket upgrades. A family sharing a network fits comfortably. Proxy peers may share budgets too; arbitrary forwarded IP headers cannot bypass them. The limiter holds at most 2,048 live buckets. These are bounded pilot safeguards, not a general DDoS service.

HTTP JSON and WebSocket messages are capped at 4 KiB. Colyseus also bounds connection messages, while game input has its own sequence/rate/queue/age validation. Browser HTTP and WebSocket origins must match the configured public origin. Originless native SDK/health requests are allowed and remain rate-limited where relevant. Short party codes are invitations, not strong private access control.

Only `/`, `/assets/*`, `/robots.txt`, intended API endpoints, and Colyseus routes are exposed. Unknown API/source/test/dotfile paths return errors rather than the application HTML. No development middleware or source maps are served. A new structural deployment or scale-out design requires new work; do not increase instances with this in-memory design.
