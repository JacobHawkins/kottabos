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
| `server/party-room.js` | Identity, seats, host controls, phase changes, validated inputs, and cumulative scores |
| `server/state.js` | Explicit synchronized schema fields |
| `server/minigames/stay-on-platform.js` | Participant setup, occupied-tile timers, authoritative movement/elimination, and one round outcome |
| `shared/` | Browser-independent constants and movement used on both sides |
| `scripts/dev.js`, `scripts/production.js` | Local development and production startup/shutdown |

The minigame has a small `createRound` / `updateRound` / `finishRound` lifecycle. Tile activation and expiry run only on the server; synchronized tile states/deadlines let clients display the warnings. Its cached outcome stays on the server. It mutates schema-shaped state without importing Colyseus or Phaser. There is deliberately no generalized minigame plugin framework.

`npm start` starts one loopback HTTP server at `127.0.0.1:2567`. Colyseus and Vite module transformation share it. Express serves the HTML directly, styles load through an ordinary link, and Vite uses `appType: 'custom'` with HMR, its WebSocket, and console forwarding disabled. This avoids Vite 8.3's injected browser client attempting a separate hot-reload connection even when HMR is disabled. Filesystem watching still invalidates browser modules for a manual refresh. See the [official Vite server options](https://vite.dev/config/server-options#server-ws). Phaser is dynamically imported only after joining a party, keeping its renderer out of the initial join-page download. The Canvas renderer loads the bundled LPC sprite sheet after joining; it uses no external art hosting, web fonts or audio downloads.

Clients send sequenced directions, start/replay requests, and diagnostic pings. They cannot submit positions, floor changes, winners, points, player IDs to control, or server configuration. The server finds a player's identity from the authenticated room connection. Start and replay requests require the current host ID.

## Production service and public boundaries

`npm run build` bundles browser assets into `dist/` using a JavaScript Vite configuration. `npm run start:prod` uses `createProductionServer()` and serves `/`, `/assets/*`, `/robots.txt`, intended APIs and the Colyseus routes on one port. It checks for the built HTML at startup and fails with a build instruction if absent. The production process never loads Vite middleware or browser-test tooling. Source files, dependencies, test artifacts and package metadata are outside the public directory. Unknown routes return JSON errors rather than an HTML application fallback. Hashed assets receive long immutable caching; HTML is revalidated. The production responses for public assets include a same-origin Content Security Policy, `nosniff` and no-referrer policy.

The production entry reads `PORT` and binds `0.0.0.0` by default; local development remains on loopback. One service and one instance hold the complete party state. Render terminates public HTTPS and forwards HTTP/WebSockets to the same Node port. The browser passes `window.location.origin` to the SDK; the pinned SDK derives WSS from HTTPS. `PUBLIC_ORIGIN`, or Render's `RENDER_EXTERNAL_URL`, defines the accepted public browser origin. An actual public WSS connection still needs deployment verification. `SIGTERM` and `SIGINT` close the game server; shutdown has a ten-second upper bound. Stopping/redeploying ends parties rather than migrating them.

Production bundling removes the diagnostics markup, simulated-drop control and `window.__partyDebug` registration. The simulated-drop method also checks the build-time development flag. Normal connection/recovery feedback remains visible. Development diagnostics keep their existing frame-rate, RTT, pending-input and listener measurements.

The default pilot limits are four rooms total and twelve connected/reserved players per room. Shared `MAX_PLAYERS` defines the party maximum across admission and client UI; future minigames reuse it. `MAX_ROOMS` is trusted server configuration; creation checks and room registration run synchronously so simultaneous requests cannot bypass it. Per direct socket peer, each minute allows 12 room creations, 240 other matchmaking/leave requests, 240 party lookups and 240 WebSocket upgrades. The limiter keeps at most 2,048 live buckets. It deliberately ignores arbitrary forwarded IP addresses; clients behind a shared family network or hosting proxy may share a budget. These safeguards bound a small playtest, not a general denial-of-service attack. Four rooms times twelve seats is a configured upper bound, not a measured 48-player hosting guarantee.

The pinned Colyseus matchmaking router uses nonstandard HTTP 522 for locked/unavailable rooms. The live hosting proxy replaced that response with HTML, hiding the useful error. The public boundary maps that HTTP status to standard 409 Conflict for matchmaking only, preserving the original JSON protocol code/message. Room admission still uses Colyseus's atomic seat reservation and the application seat check; the response adaptation grants no extra seat. Recheck this compatibility boundary if upgrading Colyseus.

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

The arena is seven by seven 64-pixel tiles: 448 by 448 pixels. Up to twelve players receive distinct colors and stable palette-derived numbers (01–12). Twelve tile-centered spawns form a symmetric inset perimeter. The host can start with at least two connected players; there is no ready field, message or gate. Countdown captures connected participants; later arrivals spectate until a later round.

The lobby draws occupied player slots in four columns and three rows. Every character uses the same bundled Universal LPC sprite sheet; colored ground markers and number badges preserve distinct identities. The local character retains a white ring, YOU label and higher draw depth. The 832×3456 PNG is unchanged from the user’s file and contains 13 columns of 64×64 cells. Walking uses rows 8–11 (up, left, down, right), columns 1–8 at 8 FPS; idle uses rows 22–25 with the slow [0,0,1] cycle; falling uses row 20, columns 0–5 once. Unused animations are not exposed as gameplay abilities.

The client selects local facing from held movement input and remote facing from interpolated displacement; local position corrections cannot turn the character around after releasing a key. Phase/round changes reset movement samples rather than treating spawn/replay placement as walking. Feet at cell y=62 anchor to the authoritative center, and the sprite scales to 75%; texture filtering preserves pixel edges. Disconnection freezes the idle pose; reduced motion shows still poses. A freshly observed alive-to-eliminated transition plays the fall once, while an already eliminated player in a fresh scene goes directly to its final pose. All animation is presentation; the server’s floor, movement and scoring rules remain unchanged.

Vite imports the sheet URL into the existing lazy game module and emits it under the production assets directory on build. No new dependency or remote art request is needed. The footer provides a local download of the generator’s full CREDITS.csv plus the upstream license/source guidance; asset provenance records the pinned catalog revision. The credit catalog is only requested on click. Audio remains explicitly disabled; action sounds can later use local movement cues and once-only authoritative transitions, with click/tap unlock and user volume controls.

Countdown and playing phases apply a viewport-sized game layout: the lobby sidebar and site footer disappear, while connection status, Leave, survivor count and touch controls remain accessible. Results restore the roster, scores and host replay controls. A ResizeObserver refreshes Phaser FIT scaling when the game container changes size, including phase transitions without a window resize. The logical arena and movement coordinates are unchanged.

A living participant's center activates each safe tile they occupy. Starting tiles activate on the first playing update at elapsed time zero, after countdown. A tile warns for 1.8 seconds, then falls permanently for that round. Leaving, returning or sharing does not reset or extend it. Untouched tiles stay safe; there is no seeded schedule, random finale, protected island or overall round deadline. Tile states remain 0 safe, 1 warning and 2 gone. The aligned tileGoneAtMs array stores simulation-elapsed expiry (zero for untouched tiles) and supports visible shrinking warning bars. Client timestamps cannot change these timers.

Each simulation step activates occupied starting tiles, moves connected living participants, activates newly occupied destination tiles, expires due warnings, then evaluates all falls together. A move off a tile during its expiry step escapes; a center on a gone tile falls. Fixed 30 Hz simulation and bounded movement prevent skipping tiles. Disconnected living participants activate tiles and remain vulnerable. Eliminated players and spectators cannot trigger tiles. There is no jumping, pushing or player collision.

- One remaining participant wins three points immediately.
- If all remaining participants fall in the same simulation step, those final fallers tie for one point each. Earlier eliminated players receive none.
- Spectators and permanently removed players receive no points. An empty round has no winner.

The cached round outcome is awarded once per round number. Results wait for host replay, which returns the same party to the lobby with cumulative scores preserved and a fresh floor. The 1.8-second warning is initial tuning; real two-person and twelve-person play should assess pacing and route variety.

## Identity and connection recovery

The six-letter invitation code identifies the party, not a player. Each new seat receives a separate random UUID, stored in connection-owned server data. Names and colors are presentation fields. The schema map is keyed by that stable player ID, independent of a transient socket.

Unexpected disconnection marks the player disconnected, clears queued movement, transfers host controls to another connected player, and asks Colyseus to reserve the seat for 120 seconds by default. `onReconnect` restores the same server player object. Permanent `onLeave`, including expired reservations, removes the player and frees the seat. These hooks follow the [Colyseus reconnection lifecycle](https://docs.colyseus.io/room/reconnection).

The first player remains host while connected. New arrivals never displace that player. When the host drops or leaves, the earliest remaining connected seat receives start/replay controls; the former host does not take them back on recovery. Refreshing causes a real temporary disconnect and therefore can transfer controls. The reported latest-joiner takeover was not reproduced in protocol or browser checks; the existing transfer rule was retained and its multi-player regressions strengthened. Host permission never transfers simulation authority away from the server.

The SDK handles reconnecting an existing room connection. Reload/reopen recovery additionally needs locally stored room information and its current reconnection credential; successful recovery must save the rotated credential. Manual SDK recovery returns a new client room object, so handlers must be attached once to that new object and old handlers disposed. See the [SDK connection and manual reconnection documentation](https://docs.colyseus.io/sdk/connection).

The browser uses an exclusive Web Lock for one active Kottabos tab per origin/profile. A second tab receives a clear message and cannot join or take over. Missing or failed Web Locks support has a distinct unsupported-browser/secure-connection explanation rather than pretending another tab owns the lock. Ordinary HTTP on a LAN address does not provide the secure context available on loopback or HTTPS. The server additionally rejects recovery of an already connected socket through its public `checkReconnectionToken` / `hasReservedSeat` hooks; a racing refresh retries until the old socket is detected as dropped. The code was checked against the pinned installed implementation because the default Colyseus behavior allows active-token takeover.

SDK automatic recovery is configured with zero minimum uptime and no offline message buffer, so an early drop is recoverable and held movement cannot replay after reconnect. Two pinned-SDK details have application guards: credential persistence runs on the next microtask because 0.18.2 fires `onReconnect` before assigning the rotated token; a wrapper around the public connection retry method rejects callbacks belonging to a retired room, because disabling recovery does not cancel an already scheduled SDK retry. Asynchronous recovery/status requests are fenced by an operation generation so a stale response cannot end a newer party. Room listeners are disposed on replacement, and the keyboard controller is constructed only once per page.

New joins first use a 90-second readiness retry budget with separate two-second health/party-lookup request limits. HTML loading pages, failed requests and malformed readiness responses produce retry feedback. Each subsequent SDK join has its own 15-second bound. Cancel aborts both HTTP work and a pending WebSocket, fences any late success, and returns control immediately. The pinned SDK lacks initial-join cancellation, so a small `PendingClient` subclass uses its installed room-factory hook to retire the pending room; this hook should be rechecked on SDK upgrades. The ordinary HTTP matchmaking/seat-reservation path is otherwise retained.

Readiness and recovery use different clocks. Recovery retries stay bounded by the saved disconnect time and reservation duration, with the server deciding whether the credential still holds a seat. Waiting for a waking host does not extend a reservation or restore an old process. Valid JSON must contain the expected health/party shape and consistent instance IDs before the client proceeds. Delayed monitor responses also check their original room, operation and recovery deadline, preserving the earlier asynchronous regressions. Provider loading screens before the app HTML arrives remain outside the application's control.

Disconnecting never restores a floor tile, changes participation, revives an eliminated player, or protects a character from hazards. Reserved seats count toward the twelve-player limit and keep their color/number. A full party refuses a thirteenth identity while allowing a valid reserved identity to recover. Host controls follow connected players and are not simulation ownership. Explicit Leave Party must clear browser recovery data and stop retries before exiting the room. Browser-local recovery requires the same profile, origin, and retained local data; cross-device recovery is outside scope.

An authenticated `POST /api/leave` uses the locally saved recovery credential to release a reserved seat when the game socket is down but HTTP is available. It compares private server credentials and rejects the stored Colyseus reservation through its normal lifecycle. A guessed room code or token cannot release another player. If all network access is lost, leaving still clears local credentials and stops retries; server-side release then depends on the reservation deadline. Host controls transfer immediately on drop and stay with the new host after the former host returns.

Room state and credentials exist only in this server process. Empty rooms and expired reservations are cleaned up. A fresh server instance has a new instance ID, allowing the client to distinguish restart/session loss from a short transport interruption. A process restart loses parties and scores; there is no crash persistence or migration between processes.

## Verification and next steps

`npm test` runs the focused rules, controller, client-session, real HTTP/WebSocket session and controlled network tests without requiring a built site. `tests/network.test.js` delays TCP data in both directions so added 100/250 ms RTT affects game frames after upgrade, not only HTTP. `npm run test:expiry` separately spends the ordinary 120-second reservation period. `npm run test:production` runs production protocol/boundary checks followed by built-browser cases; build first. Browser suites preserve the original Chrome/Edge recovery cases and add touch/layout, capability and readiness cases. Survival helpers react to synchronized tile warnings and their visible countdowns. Test execution results and unverified behavior belong in [verification](verification.md).

The owner authorized the public source repository and one approved Free Render playtest after the no-spend/account checks. Deployment work is separate from local test evidence. Real phones, remote friends, cold-host observations and subjective game feel remain acceptance tasks until recorded. Tune prediction and game balance from those observations before adding minigames or persistent identity.
