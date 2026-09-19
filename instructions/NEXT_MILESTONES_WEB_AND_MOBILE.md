# Next phase: free web play with friends and family

**Status:** proposed work, awaiting the owner's local playtest results.  
**Research snapshot:** September 15, 2026. Recheck provider terms when implementation begins.  
**Target:** one shared HTTPS link, two to four players per party, desktop keyboards and phone touch controls, with a strict $0 spending constraint.

This file is a plan and a future prompt. Writing or reading it does not authorize deployment today. No hosting account, cloud service, repository publication, application changes, or running server is needed while the owner takes time to test.

## Is this possible?

Yes. The existing architecture is a reasonable starting point for browser play across different computers and phones. A hosted Node/Colyseus process can run the same authoritative party while each browser renders its own view. Players would open an invitation link; they would not need to install an app or run Node themselves.

Deployment and phone support are separate tasks. The current game has working desktop keyboard controls, but a phone-sized page alone does not make it playable by touch. This phase adds those controls, adapts the interface, and verifies recovery on actual mobile browsers.

Each device/browser profile gets its own player. Opening the link on a phone does not recover an identity previously used on a laptop; cross-device identity transfer remains outside this phase.

This plan develops the original brief's **milestone 4** into smaller steps, **4A–4F**. It explicitly extends that brief's initial scope to phone input and permits a free hosting experiment with idle sleep. Additional minigames, accounts, persistence, and the original milestone 5 expansion remain deferred.

## Hosting choice and the meaning of $0

**Preferred candidate: one Render Free Web Service**, using the owner's familiarity with Render and the project's existing single-process design. Render supports public WebSockets. Its public socket connections should use `wss`, and HTTP and WebSockets share one service port. This makes a single hosted frontend/backend origin a good fit. [Render WebSocket documentation](https://render.com/docs/websocket)

Heroku's old free dynos ended on November 28, 2022, so the former free Heroku setup is not the baseline for this plan. [Heroku's announcement](https://devcenter.heroku.com/changelog-items/2502)

The relevant Render limits at the research date are:

- A Free service sleeps after 15 minutes without inbound HTTP or WebSocket-message traffic. Waking it takes about a minute.
- Workspaces share 750 Free instance hours per calendar month.
- Free instances can restart, and local filesystem changes are ephemeral.
- Render describes Free instances as suitable for experiments and hobby use, with limits unsuitable for a dependable production service. [Free service documentation](https://render.com/docs/free)

**Free compute is not a blanket no-charge guarantee.** Outbound HTTP and WebSocket traffic count toward bandwidth. The documented Hobby allocation is currently 5 GB per month, shared across the workspace. With a linked payment method, exceeding included bandwidth can incur charges; without one, services are suspended instead. [Bandwidth documentation](https://render.com/docs/outbound-bandwidth)

Build usage also has limits. A build-pipeline spend limit is not a universal cap on every possible charge. The agent must check the actual account's billing configuration and existing usage before a deployment is approved as satisfying $0. [Render billing FAQ](https://render.com/docs/faq)

The spending rules for this project are:

1. Use only an eligible Free service in an owner-approved account/workspace with a verified way to stop rather than bill when included usage is exhausted. Check whether existing projects share its allowances.
2. Do not add payment methods, upgrade plans, buy a domain, enable paid add-ons, create a database, or accept a trial that converts to paid service.
3. Do not remove or alter billing settings used by unrelated existing projects. If the owner's existing account cannot meet the no-spend requirement safely, finish the local preparation and explain the specific blocker before any remote creation.
4. Use the provided `onrender.com` address initially. A private source repository can be connected through an authorized Git provider; publishing the game does not require making its source public. [Render web service setup](https://render.com/docs/web-services)
5. Allow normal idle sleep. Do not create an external ping service or scheduled traffic to keep unused hosting awake. Connection heartbeats needed for active players are part of the game.

The goal is a small family playtest, initially one active party. Actual performance and usage must be measured before promising more simultaneous games. If Render's current offer no longer fits, propose another genuinely free WebSocket-capable host for review; do not silently switch providers or rewrite the networking to chase a promotion.

## What carries forward

Preserve plain JavaScript ES modules, Phaser, Node, Colyseus, the lockfile, authoritative rules, shared movement, local prediction, and remote interpolation. Keep the existing `npm start` local workflow. Keep the original brief and development journal as historical records.

The existing health endpoint, server instance ID, same-origin SDK setup, invitation links, two-minute reservation, explicit leave behavior, and session tests are useful foundations. The host remains a player with start/replay permission; simulation authority stays on the server.

Every phase must preserve these guarantees: same identity after a valid rejoin; no duplicate players or actions; disconnected characters remain vulnerable; eliminated players remain eliminated; scores apply once; host controls transfer; explicit leave stops retries; expired and restarted sessions have understandable next actions.

## 4A — Accept the local foundation

**Goal:** start from the owner's actual experience and a known working baseline.

- Read the owner's playtest notes and any new journal entries. If the owner reports a problem, reproduce and fix it before building the web phase on top of it.
- Inspect current repository guidance, status, dependencies, and available verification tools. Do not assume this folder is still unchanged or already has a Git remote.
- Run the established syntax, rules/session, and Chrome/Edge browser checks when implementing this phase. Preserve the useful tests rather than replacing them with an entirely new harness.
- Record accepted limitations: one minigame, shared center-tile ties, no persistence across process restarts, and a free host that can sleep or restart.

**Done when:** local blocking issues are resolved, the baseline passes, and reported human observations are recorded. This planning file does not itself claim that the owner's tests passed.

## 4B — Add a real production startup path

**Goal:** serve a bundled browser game and the authoritative server together, without a development server on the public internet.

The current `scripts/dev.js` starts Vite middleware and binds to `127.0.0.1`. Keep it for local work and add a separate production entry using `createAppServer()`.

Required work:

- Add a JavaScript-only Vite build that produces browser assets under `dist/`. Bundling JavaScript is allowed; do not introduce TypeScript source or compilation.
- Add a production Node entry that serves only built public assets plus the intended HTTP and Colyseus routes. Do not expose the project root, source files, package metadata, development middleware, or test artifacts. API/matchmaking errors must not accidentally become HTML responses through an overly broad fallback route.
- Read the provider's `PORT` and bind the deployed server to `0.0.0.0`. Keep one process and one instance, with HTTP and game connections using that port. Render terminates TLS for its public HTTPS service. [Render port and TLS requirements](https://render.com/docs/web-services#port-binding)
- Keep `window.location.origin` as the browser endpoint where appropriate, and verify the pinned SDK actually uses `wss` from an HTTPS page. Do not ship localhost URLs in invitations or socket configuration.
- Handle `SIGTERM` and `SIGINT` cleanly. A deployment/restart ends in-memory parties; clients must say so. Do not promise that graceful shutdown migrates an active round.
- Confirm that the production bundle has no active simulated-drop button, `window.__partyDebug`, Vite browser client, or hot-reload socket. Update local-only wording such as “LOCAL PARTY,” “KEYBOARD PLAY,” and server-running error messages where it no longer fits.
- Select and pin a currently supported compatible Node LTS version for deployment; verify the lockfile and build on the hosting runtime. Keep heavy browser-test tooling out of the runtime path.

Proposed commands to implement and document:

| Purpose | Command |
| --- | --- |
| Local development, preserved | `npm start` |
| Build public browser assets | `npm run build` |
| Serve the built game and multiplayer backend | `npm run start:prod` |
| Hosting build | `npm ci --include=dev && npm run build` |
| Hosting start | `npm run start:prod` |

The new build/production commands do **not exist yet**. The implementation agent should create and verify them. Vite's preview command is not the intended production server. [Vite deployment guidance](https://vite.dev/guide/static-deploy.html)

**Done when:** the actual built application works locally through its production entry, including two-browser joining, a full round, results/replay, and recovery. Test the built path as well as development mode.

## 4C — Make recovery work with internet delays and sleeping hosting

**Goal:** preserve the current recovery guarantees while providing useful feedback about a slow or unavailable host.

The current client uses two-second health/party-request timeouts and an initial join that can fail with local-server advice. Review that code for a cold host, a slow mobile connection, and provider responses that may be HTML instead of the expected JSON.

- Add bounded, cancelable startup/readiness retries with clear messages for waking/connecting, retryable network trouble, expired seats, full parties, and ended sessions. Keep cancellation immediate. Do not lengthen all timeouts indiscriminately.
- Recognize that the provider may show its own loading page before our HTML is available. App-level warm-up feedback begins once our client is loaded; do not claim our code controls that initial provider screen.
- Keep service readiness waiting separate from the existing seat reservation. Do not revive an expired identity, extend a reservation indefinitely, or imply that waking a fresh process restores old scores.
- Preserve the guards for rotated credentials, retired-room retries, delayed health responses, and page-close callbacks. Add regressions for any new asynchronous branches.
- Test controlled added round-trip delay, for example approximately 100 ms and 250 ms, with actual game WebSocket traffic affected. Ordinary HTTP throttling alone may not delay an existing WebSocket. Record exactly how the impairment was applied.
- Exercise connection loss while moving, explicit leave during retries, reconnection after elimination, host transfer, restart, and repeated retries. Include a full ordinary 120-second expiry case at least once, in addition to fast tests.
- Keep normal user-facing connection status in production. Any optional public performance display should expose only harmless aggregate measurements and must not enable debugging actions or reveal recovery credentials.

**Done when:** delayed or interrupted connections do not duplicate identity, movement, scores, or listeners; the player can distinguish waiting from losing a session; and the acceptance record states the tested delay/interruption conditions. Human assessment of the resulting feel remains part of 4F.

## 4D — Add phone controls and a usable mobile interface

**Goal:** a phone player and a keyboard player can join the same party and play the same game.

Default implementation choice: one fixed thumb joystick with a small dead zone. Feed its normalized direction into the existing input sequence, prediction, and server-validation path. Use the same maximum speed and movement rules as keyboards. A D-pad can replace this choice if playtesting shows it works better; do not build multiple competing control systems initially.

- Use Pointer Events and pointer capture. Handle release, cancellation, lost capture, an extra finger, pointer leaving the control, and a hybrid touch/keyboard device. Clear every input source on disconnect, elimination, relevant round transitions, blur, page hide, and visibility loss. [Pointer Events reference](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- Restrict gesture suppression to the gameplay control area. Preserve normal scrolling, zoom/accessibility behavior, and form editing elsewhere. Do not allow a joystick drag to scroll the page or become stuck movement.
- Make the arena, joystick, readiness/start/replay controls, status, and important score information usable in portrait and landscape. Account for safe areas, browser toolbars, the nickname keyboard, and rotation. Do not require fullscreen or orientation locking for basic play.
- Keep desktop WASD/arrows working. Offer a sensible touch-control toggle for devices whose input capability cannot be inferred reliably.
- Fix the current unsupported-Web-Locks path: it presently looks like an already-active-tab error. Detect capabilities accurately and provide a clear supported-browser message or a tested safe fallback. Preserve protection against duplicate tabs and active-identity takeover. Web Locks require a secure context; an HTTP LAN address is not equivalent to local loopback testing. [Web Locks reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- Target Android Chrome and iPhone Safari. Browser/device emulation can test layout and pointer paths, but it does not establish real phone compatibility.
- Treat switching between Wi-Fi and mobile data, screen lock, app switching, browser suspension, and return as recovery cases. Never promise that a phone continues simulating in the background or keeps a seat beyond its reservation.

**Done when:** automated touch and responsive-layout checks pass, desktop controls remain intact, and available real phones can join, move, stop reliably, finish, replay, and rejoin. Record unavailable device tests as pending rather than calling them passed.

## 4E — Prepare and deploy the $0 family playtest

**Goal:** one owner-approved free service, with a reproducible setup and a usable invitation URL.

Complete the local implementation and production verification before treating account access as a blocker. Then resolve only the missing deployment inputs: an authorized Render account/workspace, an authorized repository/branch, and a region sensible for the group. Do not publish the source publicly. If no suitable remote repository exists, prepare the local Git changes and ask for authorization before creating/uploading to a new private remote.

Prepare a reviewable deployment configuration, preferably a `render.yaml` or equivalent exact dashboard instructions, with:

| Setting | Planned value |
| --- | --- |
| Service | One Node Web Service |
| Compute | Explicitly Free; no paid fallback or auto-upgrade |
| Instances | One |
| Build/start | Verified commands from 4B |
| Health check | `/api/health` |
| Environment | `NODE_ENV=production`, provider `PORT`, normal game timings, explicit allowed public origin if needed |
| Address | Provider's HTTPS subdomain |
| Deploy timing | Manual initially, or another documented setting that prevents surprise updates during games |

Before publication, add proportionate public-endpoint protection: bounded room creation/join/lookup traffic, a small configurable total-room limit for the pilot, existing input/payload limits, and deliberate origin/proxy handling. Do not trust arbitrary forwarded IP headers when enforcing limits. Avoid making an entire family's shared network unable to join under an overly strict per-IP rule. A short room code is an invitation mechanism, not a strong privacy guarantee.

Verify that server logs, error responses, and test reports do not expose recovery tokens or request bodies that contain them. Use environment configuration for any deployment credentials; do not embed them in browser code, repository files, or invitation links.

Once the owner actually authorizes the target and the $0 requirement is verified, deploy, check HTTPS/WSS and production asset loading, and run a small public-URL smoke test with isolated test identities. A successful build page alone does not prove multiplayer works. Do not send invitations or messages to friends on the owner's behalf unless separately asked.

Document how to view service logs and usage, deploy an update between play sessions, roll back a bad release, and suspend/remove this service when finished. Use normal provider controls; do not add a recurring monitoring service to this scope.

**Done when:** the approved free service is reachable, multiple test clients can complete the shared loop through its public URL, and the exact configuration, deployment revision, cost assumptions, and shutdown/update instructions are recorded. If account access or enforceable $0 hosting is unavailable, deliver the tested deployment-ready files and exact remaining steps, clearly marking deployment incomplete.

## 4F — Run a real family/friend playtest

**Goal:** verify what local automation cannot establish.

Start with two people, then try four. Include at least one person on a different internet connection and, when available, a mixed phone/desktop party. Open the service ahead of the planned session so its first wake-up is not confused with gameplay lag. After the session, let unused hosting sleep normally.

Use Leave Party and close game tabs when the group is finished so active clients stop sending traffic. Do not deploy updates in the middle of a match.

| Scenario | Evidence to record |
| --- | --- |
| First visit after idle sleep | What the provider/client shows, time until joining is possible, and whether retry is understandable |
| Two and four players | Shared roster, readable characters, consistent result/score, and replay |
| Remote movement | Region, device/browser, approximate RTT, frame rate if measurable, and subjective control feel |
| Refresh and brief drop | Same player returns while valid; no duplicate actions or listeners |
| Disconnected on an unsafe tile | Server still eliminates the character; returning does not revive it |
| Phone app switch, rotation, screen lock, and network switch | Input clears and return behaves honestly within or beyond the reservation |
| Host leaves / player explicitly leaves | Controls transfer; automatic rejoin stops; seat is released or expires if fully offline |
| Restart or deploy between sessions | Old party is unavailable with clear feedback; a new party works |
| Cost observation | Actual workspace usage before/after the test, build usage, and a documented stop threshold below included limits |

A service restart or idle shutdown loses in-memory rooms and scores. A normal short network interruption can recover the reserved player if that process and reservation still exist. Keep these distinct in the playtest instructions.

**Done when:** the owner records an actual remote play session and available real-phone results, with defects and next actions. If friends/devices are not available during the agent run, finish all independent work and leave a concise manual checklist. Do not claim remote-family or real-phone acceptance from emulation alone.

## Deliverables and limits for the next agent

Expected deliverables are a production build/start path, touch controls and responsive UI, improved startup/recovery feedback, focused tests, a deployment configuration, updated README/architecture/verification notes, and a new development journal about the actual work and mistakes. Include a brief invitation/play guide the owner can share themselves.

Preserve the current gameplay and recovery guarantees. Defer accounts, databases, Redis, multi-instance scaling, mobile app packaging, new minigames, major art work, custom domains, paid services, and making parties survive server restarts. Do not add these just because a deployment tutorial includes them.

Existing local work can still be started later with:

```powershell
cd C:\Users\JakeS\Documents\Projects\kottabos
npm start
```

That command starts the current local version, not the future hosted service. This planning task leaves it stopped.

## Prompt for the next programming session

Copy this only after completing your local tests. Edit the first paragraph to describe any issues instead of claiming success if something failed. Sending the prompt is the future request to implement this plan; it does not schedule or start work merely by existing in this file.

```text
My local Kottabos playtests passed, and I am ready for the next phase. If I attach playtest notes or describe issues in this conversation, incorporate them and fix blocking regressions first.

Read instructions/NEXT_MILESTONES_WEB_AND_MOBILE.md, PARTY_GAME_PROJECT_BRIEF.md, AGENTS.md, README.md, docs/architecture.md, docs/verification.md, relevant gamedevjournals entries, and any newer repository guidance. Use the next-milestone plan as the specification for this phase. It extends the original desktop scope to phone browser controls and a free hosting experiment; preserve the existing recovery and authoritative-gameplay guarantees.

Implement milestones 4A–4F as far as the available tools, account access, and real devices permit. The target is two to four friends or family members playing through one HTTPS invitation URL on desktop keyboards and phone touch controls. Prefer one Render Free Node Web Service serving the built Phaser client and Colyseus backend together. Keep plain JavaScript ES modules and the existing stack. Do not introduce TypeScript source or a TypeScript compilation workflow.

I authorize local dependency installation, project edits, local development/production servers, production builds, focused automated tests, and browser tests for this work. Preserve npm start for local development. Add and test the production build/start path, same-origin HTTPS/WSS behavior, cold-start-aware and cancelable recovery, phone controls, responsive layouts, and proportionate public request/room limits. Preserve identity, scores, elimination, host transfer, explicit leave, duplicate-tab protection, input clearing, and the existing asynchronous recovery regressions.

Research current official documentation and free-tier/billing terms before relying on them. My spending limit for this work is $0. Do not add a payment method, buy anything, enable paid services or trials, change unrelated account billing, or create keep-awake traffic. A Free compute label alone is insufficient: verify the account's treatment of bandwidth/build overages and shared quotas. If enforceable no-spend hosting is unavailable, complete the useful local work and explain the exact blocker instead of silently accepting charge exposure or choosing a paid fallback.

This request authorizes deployment of one Free Render Web Service once I identify or confirm the destination account/workspace and authorized source repository/branch and the no-spend condition is verified. Prepare and verify the concrete build and proposed configuration before that deployment step. Use an existing authorized repository when available. Ask before creating/uploading to a new remote repository, and never make the source public without my explicit request. If authentication or interactive login is required, let me perform that step; do not start an interactive login flow or ask me to paste secrets into the conversation. Do not modify other services or contact friends on my behalf.

Make routine implementation choices independently. Ask only for genuinely missing account/repository authorization, necessary device or location information, or a material blocker; continue independent local work while those details are unresolved. Verify each milestone and retain the established regression tests. Test the built production path, not only Vite development mode. Include controlled WebSocket delay/interruption and repeated recovery. Clearly separate browser emulation from actual phone testing and local automation from a friend on another network.

Deliver the implementation, reproducible deployment configuration and exact commands, updated documentation, cost and sleep/restart limitations, test results, and a new gamedevjournals entry describing the work, mistakes, and lessons. If deployment succeeds, report the actual public URL and revision, how to play from phones/computers, and how to update, inspect usage, and stop the service. If external access or real-device testing remains unavailable, state precisely what is complete and what still needs me. Stop temporary local servers at the end unless I ask to keep them running; keep any intentionally deployed playtest service state explicit. Do not call an untested mobile or remote play experience verified.
```
