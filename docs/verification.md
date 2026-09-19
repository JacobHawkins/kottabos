# Verification record

## September 19, 2026 — web and phone phase

The owner reported successful local playtests, a perceived host transfer on later joins, visible movement delay between screens, and predictable center-island endings. Four-player protocol tests did not reproduce joins stealing host: the existing rule keeps a connected creator and transfers on refresh/drop/leave without taking controls back on rejoin. The UI now names the host and explains this rule. Final islands now vary across nine central tiles; 200-seed rule checks prove variety, connected remaining floor, and reachable escape within the warning interval.

The server remains the authority for movement, hazards and results. Screens show predicted/interpolated presentation; remote characters have 100 ms interpolation delay in addition to network travel. Agreement on outcomes does not imply simultaneous pixels or perfect internet game feel.

### Local verification completed

- Downloaded official Node **24.21.0** Windows runtime, verified its ZIP against official SHA-256 checksums, and used it for clean `npm ci --include=dev`, production build, syntax checks and the combined automated tests. Existing Node **22.18.0** also ran protocol/browser checks. No Colyseus/Phaser version changed; lockfile retained. Installation reported zero vulnerabilities.
- Vite production output is approximately 7.5 kB HTML, 14.5 kB CSS, 190 kB initial JS and a separately loaded 1.38 MB Phaser/game chunk (before compression). The large-chunk warning remains; Phaser only downloads after joining. No HMR, simulated-drop control, source maps or `window.__partyDebug` ships in the production path.
- Original **seven Chrome/Edge browser cases passed**, including whole-browser reopen, identity/score preservation, duplicate-tab protection, explicit leave during retry, stale health response, eliminated recovery, host transfer and server restart. The full-round test now follows visible safe tiles with keyboard events instead of assuming a center island.
- Focused input/controller tests cover analog dead zone, bounded combined touch/keyboard direction, capture, extra finger, release outside, cancellation/lost capture, blur/pagehide/visibility/rotation, disconnect, elimination and phase/round clearing.
- **13 deterministic client-session tests** cover provider HTML, bounded readiness, cancellation during health/matchmaking/WebSocket handshake, stale operations, corrupt saved timing metadata, full/missing parties, expired recovery and page close.
- **Four production recovery browser cases passed** with controlled provider HTML, held health and matchmaking responses, and a held WebSocket handshake. These use the shipped UI without debug hooks.
- **Two built-server protocol/protection tests passed**: a full round, identical scoring, recovery and replay; only public assets exposed; unknown APIs and source paths remain errors; origin rejection on HTTP/WebSocket; oversized/chunked JSON rejection; forged forwarded IP cannot evade limits.
- A transparent TCP proxy delayed every data chunk in each direction by **50 ms or 125 ms**, adding approximately **100 ms or 250 ms RTT to actual game WebSocket traffic**, not merely HTTP. Node 24 run measured game ping RTT **125.0 ms / 272.9 ms**, with HTTP **158.9 ms / 270.8 ms**. Movement ordering, three repeated recoveries, host transfer/no reclaim, disconnected hazards, eliminated recovery, scores once and explicit leave passed. This is controlled delay/interruption, not a packet-loss or mobile-radio benchmark.
- The separate full ordinary expiry test retained a disconnected player through 119 seconds, removed the seat at **119,991 ms after the test observed the drop**, rejected the old credential, and admitted a fresh identity. Normal server configuration remains 120 seconds; the small observation offset is expected.

### Production/mobile integration and publication

Final local production run on Node **24.21.0** passed **two protocol/protection tests and all eight built-browser cases** in 41.3 seconds of browser execution. The latter includes Chrome/Edge invitation/host/round/repeated refresh/results/replay, cold-host cancellation, four delayed-recovery cases and two mobile/capability cases. No uncaught browser JavaScript errors were reported.

The mobile cases used desktop Chrome with touch emulation at **390×844 portrait** and **844×390 landscape**. Actual CDP touch sequences drove the joystick; visible canvas pixels on both clients proved movement. Tests covered the dead zone, second finger, release outside, cancellation, normal scrolling over the canvas, keyboard input, rotation, scores/replay, refresh identity and touch-toggle persistence. Portrait/landscape screenshots were visually inspected and an intrinsic-width overflow fixed. These are not iPhone Safari tests.

Screenshots/test artifacts are ignored local files, not public repository content. Test setup uses isolated browser profiles and controlled local ports; everyday browser profiles are untouched. Source publication and live-service results are recorded separately below.

### Still requires people and real devices

The available physical target is **two iPhones using Safari**, possibly Chrome on iPhone. No actual iPhone, app switch, screen lock, Wi-Fi/cellular switch, or friend on another network has yet been verified. Chrome touch emulation is only pointer/layout evidence. Use [the family acceptance sheet](playtest.md). Public-URL automation, if completed below, still runs from this one computer and is not a remote-family playtest. Free-host idle cold-start timing must be observed on the real service; injected loading HTML only tests the app's response.

## September 15, 2026 — original local milestones (historical)

Verified on September 15, 2026, on Windows with Node.js 22.18.0 and npm 11.5.2. This record covers the first three milestones in the project brief. Tests used this computer's loopback interface; no remote service, account, login, deployment, or purchase was involved.

## Commands and environment

| Check | Result |
| --- | --- |
| `npm install --no-fund` | Installed the pinned dependency graph; npm reported zero vulnerabilities. `package-lock.json` retained. |
| `npm ls --depth=0` | All eight direct packages resolved to the intended exact versions, with no invalid peer dependency report. |
| `npm run check` | Passed project JavaScript syntax and JavaScript-only source checks. |
| `npm test` | Passed 20 tests as reported by Node: 10 rules tests, nine session subtests, and their parent test. |
| `npm run test:browser` | All seven complete browser acceptance cases passed in 1.1 minutes, including the delayed-health-response regression, with zero uncaught browser JavaScript errors. |
| `npm start` | Serves the page and Colyseus together at `http://127.0.0.1:2567`. |
| Unaccelerated default round | Two real SDK connections played a full default round: countdown about 3,013 ms, round about 44,953 ms wall time / exactly 45,000 ms simulation time, both survivors received the same +1 tie and scores. Health confirmed the ordinary 120-second reservation. |
| Starting a second server on the occupied port | Exited with code 1 in under one second and explained which port was occupied; the original server kept running. |

Browser automation launched the installed **Google Chrome 153.0.8010.37** and **Microsoft Edge 153.0.4234.32**, each in an isolated test profile/context. These are two different browser applications. The whole-browser reopen case launched and closed a separate Chrome process with a temporary persistent profile; everyday browser profiles were not modified.

The acceptance server uses port 2579, a 350 ms countdown, 20-second rounds, and four-second reservations to keep repeated tests quick. The restart case owns a separate server on port 2580 and actually stops and starts that Node process. These overrides are supplied by the tests, not by joining players. The ordinary startup defaults are a three-second countdown, 45-second rounds, and 120-second reservations.

## Milestone 1: foundation and lobby

- Created a party in Chrome and joined it from Edge using the invitation URL; verified the short code, distinct player IDs, unique colors, both roster entries, and visible Phaser characters.
- Verified invitation query strings contain the public room code and no recovery credential.
- Verified invalid nicknames are rejected, fresh identities are server-generated, readiness is synchronized, and a non-host cannot start the round.
- Verified the four-seat limit includes disconnected reservations and that an expired or explicitly released seat can be reused.
- Verified a second tab in the same browser profile gets a clear active-tab message without duplicating or taking over the player. Protocol tests also rejected an active credential takeover.

## Milestone 2: playable round and replay

- Started a round through the real ready/start buttons and observed the same authoritative playing phase in both browsers.
- Moved characters using actual browser keyboard events and verified their server positions changed. Walked survivors toward the center and another player toward a tile that later disappeared.
- Verified floor warnings, falling, elimination, spectator state, late join during a round, and inability to revive by refreshing.
- Verified both browsers display the same results and scores, refresh retains an earned score, and replay returns the persistent party to the lobby for another start.
- Rule tests cover fixed-speed normalized movement, bounds, deterministic warning schedules, exact warning/fall boundaries, deadline ties, simultaneous final falls, sole-survivor wins, and permanent-removal boundary cases.
- Input/session tests verify duplicate sequences and invalid/unbounded values cannot add movement, and the server consumes at most one command per simulation step.

## Milestone 3: recovery acceptance

| Brief acceptance item | Verification |
| --- | --- |
| Refresh in the lobby and during a round | Same player ID restored, roster count unchanged; repeated lobby refreshes and playing/results refreshes passed. |
| Brief interruption | Closed the real game WebSocket and delayed automatic retry for three seconds, both in the lobby and during play. The other browser saw disconnected state and stopped movement, then the same identity rejoined. |
| Close and reopen | Passed tab close/reopen with preserved local storage and full Chrome process close/reopen with a persistent test profile. |
| Rejoin after elimination | Browser refresh preserved elimination and spectating; protocol test also disconnected a character through an authoritative hazard and rejoined without revival. |
| Creator leaves | Host controls transferred, the remaining party continued, and replay/start controls worked from the new host. |
| Explicit leave | Cleared local recovery and released the seat. Also left while the SDK had a pending retry; no ghost reconnection or duplicate seat appeared. Authenticated HTTP release rejected guessed credentials. |
| Expired reservation / unavailable party | After a four-second test reservation expired, the UI explained the loss and successfully joined a fresh identity by room code. Empty rooms were cleaned up. |
| Repeat recovery | Three refreshes and additional drop/reopen cycles retained eight application room listeners and one Phaser scene. No duplicate players, scores, or actions appeared. |
| Server restart | Stopped and restarted the isolated server, observed an ended-session explanation in both browsers, and created a working new party with a new identity. Protocol tests confirmed old credentials were invalid. |

A focused timing regression holds a health response until after automatic recovery succeeds, then releases it. This verifies that an old health poll cannot mistake the cleared recovery deadline for an expired reservation and end the restored connection. The page-close path also detaches the departing room before closing its socket so SDK close callbacks cannot initiate another manual rejoin.

## Visual and performance observations

Inspected full-page screenshots of the home screen, two-player lobby, playing/eliminated view, and results at a 1360-pixel viewport. The Phaser canvas, placeholder players, tile grid, roster, score display, controls, and recovery feedback rendered without overlap. Screenshots and diagnostic JSON are generated under ignored `test-results/`; an additional startup smoke capture is under ignored `artifacts/qa/`.

Representative local end-of-round samples from both browsers showed **60 FPS**, **1 ms application ping RTT**, about **0.01–0.02 ms server simulation callback cost**, **zero pending inputs**, **eight application room listeners**, and **one Phaser scene**. These are spot observations, not percentile measurements or a performance guarantee. Server callback cost excludes encoding, transport, and the rest of the event loop.

Implementation review also checked local prediction, acknowledgment replay, focus-loss clearing, and remote interpolation. A focused controller smoke check exercised the fractional-tick preview and acknowledgment path. Feeling responsive and being fun still require human playtesting.

## Not verified or intentionally deferred

- No remote friend, real internet route, public hosting, TLS, physical network adapter interruption, or sustained artificial latency/loss was tested. Turning off Wi-Fi does not disrupt traffic to `127.0.0.1`.
- Reservation expiry was accelerated for automation; the full 120-second wait was not timed end to end. The configured ordinary default is 120 seconds and the same expiry path is exercised.
- Safari, Firefox, mobile input, poor GPUs, prolonged background suspension, and heavily overloaded server behavior were not tested.
- Node 24 was not executed on this machine; the tested runtime was Node 22.18.0. Both are supported LTS lines, and dependency engine constraints were checked.
- No production build was run; local development and targeted tests were the authorized deliverable. No production persistence, cloud resources, or deployment were added.
- Closing/refreshing loses identity if browser-local credentials are deleted. Restarting the server always loses in-memory parties and scores. Fully offline explicit leave cannot notify the server until connectivity returns, so its seat expires normally.
- The center island allows shared survival ties. Art, sound, competitive balance, correction smoothing under internet latency, and additional minigames remain future work.
