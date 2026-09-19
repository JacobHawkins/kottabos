# Architecture and implementation decisions

The original project brief and [web/mobile milestone plan](../instructions/NEXT_MILESTONES_WEB_AND_MOBILE.md) define the scope. One authoritative, in-memory Node.js process runs Colyseus parties; Phaser renders the arena and ordinary HTML/CSS supplies the surrounding interface. The web phase adds a production build, cancelable service readiness, touch input and a bounded free-hosting pilot. There are no player accounts, database or public matchmaking. The current deployment and verification status belongs in [verification](verification.md), not an assumption made from this architecture.

## JavaScript and dependency choices

All project source and configuration are JavaScript ES modules. There are no project TypeScript files, decorators, TypeScript compiler, or TypeScript build step. Colyseus schemas use the documented `schema()` and `t.*` builder, which runs directly in JavaScript. Dependency packages may contain their own TypeScript definitions. See [Colyseus schema documentation](https://docs.colyseus.io/state/schema).

Direct dependencies are pinned in `package.json`; `package-lock.json` pins the resolved dependency graph:

| Package | Pinned version | Purpose |
| --- | --- | --- |
| `@colyseus/core` | 0.18.14 | Rooms, matchmaking, authoritative lifecycle |
| `@colyseus/schema` | 5.0.32 | Shared state serialization |
| `@colyseus/sdk` | 0.18.2 | Browser and test protocol clients |
| `@colyseus/ws-transport` | 0.18.2 | WebSocket transport |
| `phaser` | 4.2.1 | Arena presentation; keyboard/touch controller is plain JavaScript |
| `express` | 5.2.1 | Health, party lookup and built public assets |
| `vite` | 8.3.0 | Local development and browser asset bundling |
| `@playwright/test` | 1.63.0 | Browser acceptance tests |

`.node-version` pins Node.js **24.21.0** for deployment. The package engine floor remains 22.12.0; local tests have also run on 22.18.0. See the [official Node release schedule](https://nodejs.org/en/about/previous-releases). Phaser 4.2.1 is identified by its [official release page](https://phaser.io/download/release/v4.2.1); consult the [Phaser documentation](https://docs.phaser.io/) and installed package source when checking APIs. Upgrade the Colyseus packages together after checking their documented compatibility.

## Separation of responsibilities

| Location | Responsibility |
| --- | --- |
| `client/` | Lobby, cancelable joining/recovery, keyboard/touch input, prediction and Phaser presentation |
| `server/app.js` | Shared HTTP/WebSocket services and trusted server configuration |
| `server/production.js` | Built public assets, response headers and explicit missing-route behavior |
| `server/public-guard.js` | HTTP/WebSocket origin checks, request budgets and bounded JSON bodies |
| `server/party-room.js` | Identity, seats, readiness, host controls, phase changes, validated inputs, and cumulative scores |
| `server/state.js` | Explicit synchronized schema fields |
| `server/minigames/stay-on-platform.js` | Participant setup, floor schedule, authoritative movement/elimination, and one round outcome |
| `shared/` | Browser-independent constants and movement used on both sides |
| `scripts/dev.js`, `scripts/production.js` | Local development and production startup/shutdown |

The minigame has a small `createRound` / `updateRound` / `finishRound` lifecycle. Its temporary schedule and cached outcome stay on the server. It mutates schema-shaped state without importing Colyseus or Phaser. There is deliberately no generalized minigame plugin framework.

`npm start` starts one loopback HTTP server at `127.0.0.1:2567`. Colyseus and Vite module transformation share it. Express serves the HTML directly, styles load through an ordinary link, and Vite uses `appType: 'custom'` with HMR, its WebSocket, and console forwarding disabled. This avoids Vite 8.3's injected browser client attempting a separate hot-reload connection even when HMR is disabled. Filesystem watching still invalidates browser modules for a manual refresh. See the [official Vite server options](https://vite.dev/config/server-options#server-ws). Phaser is dynamically imported only after joining a party, keeping its renderer out of the initial join-page download. The Canvas renderer and code-drawn shapes need no external art, font, or audio downloads.

Clients send sequenced directions, ready/start/replay requests, and diagnostic pings. They cannot submit positions, floor changes, winners, points, player IDs to control, or server configuration. The server finds a player's identity from the authenticated room connection. Start and replay requests require the current host ID.

## Production service and public boundaries

`npm run build` bundles browser assets into `dist/` using a JavaScript Vite configuration. `npm run start:prod` uses `createProductionServer()` and serves `/`, `/assets/*`, `/robots.txt`, intended APIs and the Colyseus routes on one port. It checks for the built HTML at startup and fails with a build instruction if absent. The production process never loads Vite middleware or browser-test tooling. Source files, dependencies, test artifacts and package metadata are outside the public directory. Unknown routes return JSON errors rather than an HTML application fallback. Hashed assets receive long immutable caching; HTML is revalidated. The production responses for public assets include a same-origin Content Security Policy, `nosniff` and no-referrer policy.

The production entry reads `PORT` and binds `0.0.0.0` by default; local development remains on loopback. One service and one instance hold the complete party state. Render terminates public HTTPS and forwards HTTP/WebSockets to the same Node port. The browser passes `window.location.origin` to the SDK; the pinned SDK derives WSS from HTTPS. `PUBLIC_ORIGIN`, or Render's `RENDER_EXTERNAL_URL`, defines the accepted public browser origin. An actual public WSS connection still needs deployment verification. `SIGTERM` and `SIGINT` close the game server; shutdown has a ten-second upper bound. Stopping/redeploying ends parties rather than migrating them.

Production bundling removes the diagnostics markup, simulated-drop control and `window.__partyDebug` registration. The simulated-drop method also checks the build-time development flag. Normal connection/recovery feedback remains visible. Development diagnostics keep their existing frame-rate, RTT, pending-input and listener measurements.

The default pilot limits are four rooms total and four connected/reserved players per room. `MAX_ROOMS` is trusted server configuration; creation checks and room registration run synchronously so simultaneous requests cannot bypass it. Per direct socket peer, each minute allows 12 room creations, 240 other matchmaking/leave requests, 240 party lookups and 240 WebSocket upgrades. The limiter keeps at most 2,048 live buckets. It deliberately ignores arbitrary forwarded IP addresses; clients behind a shared family network or hosting proxy may share a budget. These safeguards bound a small playtest, not a general denial-of-service attack.

HTTP POST JSON bodies and WebSocket payloads are capped at 4 KiB. The HTTP bound also applies to chunked requests and precedes Colyseus dispatch. Because Colyseus installs matchmaking before Express, the guard wraps the bound HTTP request listeners at startup instead of relying only on Express middleware. Browser HTTP and WebSocket requests with an Origin header must match the configured origin. Originless SDK/health requests remain available. Only the create-party, join-by-code and reconnect matchmaking routes are exposed. Errors do not echo request bodies or recovery credentials. Short room codes remain invitation identifiers, not strong access-control secrets.

The Free Render service configuration and no-spend account checks are documented in [deployment](deployment.md). Free sleep/restarts and workspace quota suspension are accepted pilot limitations. There is no keep-awake job, database, persistent disk or automatic scale-out.

## Simulation and controls

The server advances at 30 fixed simulation steps per second and sends state patches at 20 Hz. Each accepted movement command represents one simulation step. Commands contain a positive increasing safe-integer sequence and finite axes between -1 and 1. Diagonal directions are normalized. Movement is 150 pixels per second, and the player's center is clamped inside the arena.

The input queue holds at most six commands. The server drops commands more than 250 ms old, rejects duplicate/out-of-order sequences, and accepts at most 90 input messages per player per second. An overall 120-message-per-second connection limit and 4 KiB WebSocket payload limit provide additional bounds. A disconnected player receives no movement, and clearing inputs discards pending commands. No client timestamp or claimed elapsed time can increase movement speed.

Prediction uses the same movement function as the server. Authoritative positions and acknowledged input sequences allow the client to discard confirmed commands and reconcile pending movement. A fractional-tick preview responds on the next animation frame. Remote characters interpolate between recent snapshots with a 100 ms display delay. Position corrections currently snap when server authority differs; this improves feedback but does not promise zero lag or internet-ready movement quality.

Each simulation callback processes at most five catch-up steps after a long process stall. Severe stalls can make simulation time advance more slowly than wall time; recovery from a suspended or overloaded host is a limitation of this prototype. Diagnostic measurements distinguish client frame rate, network round trip, connection state, and server simulation callback cost.

The phone control is one fixed thumb joystick using Pointer Events and pointer capture. A 12% dead zone prevents tiny accidental drags; movement strength scales with distance and clamps to the shared maximum. Keyboard and touch directions combine through the same normalization, sequencing, prediction and server-validation path, so using both does not increase maximum speed. The first captured pointer owns the drag; an extra finger cannot replace it. Release, cancellation and lost capture clear touch movement. Disconnect, elimination, phase/round transitions, blur, page hide, visibility loss and resize clear all input sources. A stored touch-control toggle supports hybrid devices when capability detection is insufficient.

Only the joystick suppresses touch gestures. The page and arena retain normal scrolling/zoom behavior. CSS adapts the arena, roster and controls for portrait and short landscape viewports, includes safe-area padding, and uses larger form/button targets. Fullscreen and orientation locking are not required. Emulated layouts and pointer events cannot establish physical Android Chrome or iPhone Safari behavior under screen lock, app suspension or network switching.

## Stay on the Platform and scoring

The arena is seven by seven 64-pixel tiles: 448 by 448 pixels. Up to four players receive distinct colors and spawn near different corners. A countdown captures the connected participants; a new arrival after that capture spectates until a later round.

Normal rounds last at most 45 seconds of simulation time. Each seeded schedule chooses its final island from the nine central tiles; repeated destinations are possible. The choice is independent of player identity and the centered set gives the four corner spawns symmetric travel-distance possibilities. Manhattan-distance rings disappear from outside toward that destination, shuffling equal-distance tiles and using larger waves and shorter gaps toward the end. Every surviving tile retains an orthogonal path inward; square-ring random removal could instead strand a corner behind holes. The future schedule stays server-private.

The first warning begins after four seconds; each disappearing tile warns for 1.8 seconds. A 200-seed test checks all nine destinations, connected remaining floor and a path to surviving floor within the warning's movement allowance at ordinary timings. Tile states are `0` safe, `1` warning and `2` gone. A player's center entering a gone tile eliminates them; placeholder character radius is visual only. There is no jumping, pushing or player-to-player collision. The original center-only design is preserved as history in journal 001; it is no longer the current rule.

The movement step completes, floor changes apply, and eliminations are evaluated together. These are the explicit scoring rules:

- One remaining participant wins three points immediately.
- If all remaining participants fall in the same simulation step, those final fallers tie for one point each. Earlier eliminated players receive none.
- Multiple survivors at the deadline tie for one point each.
- Spectators and permanently removed players receive no points. An empty round has no winner.

`finishRound` caches one outcome. The party awards that outcome once per round number and holds the results screen until the host requests replay. Replay returns the same party to the lobby, preserves cumulative scores, and resets readiness. Standing together on the final island is intentionally allowed; balancing this simple game's long-term challenge remains a playtesting task.

## Identity and connection recovery

The six-letter invitation code identifies the party, not a player. Each new seat receives a separate random UUID, stored in connection-owned server data. Names and colors are presentation fields. The schema map is keyed by that stable player ID, independent of a transient socket.

Unexpected disconnection marks the player disconnected, clears queued movement and readiness, transfers host controls to another connected player, and asks Colyseus to reserve the seat for 120 seconds by default. `onReconnect` restores the same server player object. Permanent `onLeave`, including expired reservations, removes the player and frees the seat. These hooks follow the [Colyseus reconnection lifecycle](https://docs.colyseus.io/room/reconnection).

The first player remains host while connected. New arrivals never displace that player. When the host drops or leaves, the earliest remaining connected seat receives start/replay controls; the former host does not take them back on recovery. Refreshing causes a real temporary disconnect and therefore can transfer controls. The reported latest-joiner takeover was not reproduced in protocol or browser checks; the existing transfer rule was retained and its multi-player regressions strengthened. Host permission never transfers simulation authority away from the server.

The SDK handles reconnecting an existing room connection. Reload/reopen recovery additionally needs locally stored room information and its current reconnection credential; successful recovery must save the rotated credential. Manual SDK recovery returns a new client room object, so handlers must be attached once to that new object and old handlers disposed. See the [SDK connection and manual reconnection documentation](https://docs.colyseus.io/sdk/connection).

The browser uses an exclusive Web Lock for one active Kottabos tab per origin/profile. A second tab receives a clear message and cannot join or take over. Missing or failed Web Locks support has a distinct unsupported-browser/secure-connection explanation rather than pretending another tab owns the lock. Ordinary HTTP on a LAN address does not provide the secure context available on loopback or HTTPS. The server additionally rejects recovery of an already connected socket through its public `checkReconnectionToken` / `hasReservedSeat` hooks; a racing refresh retries until the old socket is detected as dropped. The code was checked against the pinned installed implementation because the default Colyseus behavior allows active-token takeover.

SDK automatic recovery is configured with zero minimum uptime and no offline message buffer, so an early drop is recoverable and held movement cannot replay after reconnect. Two pinned-SDK details have application guards: credential persistence runs on the next microtask because 0.18.2 fires `onReconnect` before assigning the rotated token; a wrapper around the public connection retry method rejects callbacks belonging to a retired room, because disabling recovery does not cancel an already scheduled SDK retry. Asynchronous recovery/status requests are fenced by an operation generation so a stale response cannot end a newer party. Room listeners are disposed on replacement, and the keyboard controller is constructed only once per page.

New joins first use a 90-second readiness retry budget with separate two-second health/party-lookup request limits. HTML loading pages, failed requests and malformed readiness responses produce retry feedback. Each subsequent SDK join has its own 15-second bound. Cancel aborts both HTTP work and a pending WebSocket, fences any late success, and returns control immediately. The pinned SDK lacks initial-join cancellation, so a small `PendingClient` subclass uses its installed room-factory hook to retire the pending room; this hook should be rechecked on SDK upgrades. The ordinary HTTP matchmaking/seat-reservation path is otherwise retained.

Readiness and recovery use different clocks. Recovery retries stay bounded by the saved disconnect time and reservation duration, with the server deciding whether the credential still holds a seat. Waiting for a waking host does not extend a reservation or restore an old process. Valid JSON must contain the expected health/party shape and consistent instance IDs before the client proceeds. Delayed monitor responses also check their original room, operation and recovery deadline, preserving the earlier asynchronous regressions. Provider loading screens before the app HTML arrives remain outside the application's control.

Disconnecting never restores a floor tile, changes participation, revives an eliminated player, or protects a character from hazards. Reserved seats count toward the four-player limit. Host controls follow connected players and are not simulation ownership. Explicit Leave Party must clear browser recovery data and stop retries before exiting the room. Browser-local recovery requires the same profile, origin, and retained local data; cross-device recovery is outside scope.

An authenticated `POST /api/leave` uses the locally saved recovery credential to release a reserved seat when the game socket is down but HTTP is available. It compares private server credentials and rejects the stored Colyseus reservation through its normal lifecycle. A guessed room code or token cannot release another player. If all network access is lost, leaving still clears local credentials and stops retries; server-side release then depends on the reservation deadline. Host controls transfer immediately on drop and stay with the new host after the former host returns.

Room state and credentials exist only in this server process. Empty rooms and expired reservations are cleaned up. A fresh server instance has a new instance ID, allowing the client to distinguish restart/session loss from a short transport interruption. A process restart loses parties and scores; there is no crash persistence or migration between processes.

## Verification and next steps

`npm test` runs the focused rules, controller, client-session, real HTTP/WebSocket session and controlled network tests without requiring a built site. `tests/network.test.js` delays TCP data in both directions so added 100/250 ms RTT affects game frames after upgrade, not only HTTP. `npm run test:expiry` separately spends the ordinary 120-second reservation period. `npm run test:production` runs production protocol/boundary checks followed by built-browser cases; build first. Browser suites preserve the original Chrome/Edge recovery cases and add touch/layout, capability and readiness cases. Survival helpers in the varying-floor round respond to synchronized tile colors rather than reading the future schedule. Test execution results and unverified behavior belong in [verification](verification.md).

The owner authorized the public source repository and one approved Free Render playtest after the no-spend/account checks. Deployment work is separate from local test evidence. Real phones, remote friends, cold-host observations and subjective game feel remain acceptance tasks until recorded. Tune prediction and game balance from those observations before adding minigames or persistent identity.
