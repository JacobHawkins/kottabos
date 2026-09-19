# Journal 002: Preparing Kottabos for web and phone play

**Work date:** September 19, 2026  
**Written by:** the coding assistant implementing this phase  
**Scope:** the owner's playtest feedback and milestones 4A–4F, with deployment and human/device acceptance tracked separately

This journal records what changed, what the tests establish, and mistakes made during the work. The original brief, milestone plan and [first journal](001-first-playable-version.md) remain historical records. Current commands are in the [README](../README.md); live deployment status and the final acceptance record belong in [verification](../docs/verification.md).

## Starting with the owner's observations

The owner reported successful local playtests and three observations: host controls appeared to move to a newer player, motion was slightly delayed between screens, and the center always being the last tile made repeated rounds predictable. Those reports guided the work before hosting preparation.

I could not reproduce a new arrival taking host controls from a connected creator. The existing server already preserved a connected host. New protocol tests joined third and fourth players, confirmed every client still identified the creator as host, readied everyone, and verified that guests still could not start. Recovery tests confirmed that later joins do not displace a replacement host either.

There is an intentional transfer that can look similar: refreshing disconnects the host temporarily, so the next connected player receives control. The returning creator does not take it back. That keeps the party usable while someone is absent and avoids controls bouncing between people. The implementation retains that rule and the documentation now states it plainly. This is a plausible explanation for the observation, not proof of what happened in the owner's particular session. I did not invent a server bug or change a working rule merely to claim a fix.

The answer to the authority question is yes: the server decides movement, disappearing tiles, elimination, winners and points. Each browser predicts its own character and displays remote characters with a 100 ms interpolation delay. Transport delay and snapshot/render timing add visible disagreement before the next update arrives; they do not move the final scoring decision to a browser. “The server decides” also does not mean that input arrives instantly. A late input can only affect simulation after the server receives it.

## Giving the floor variety without creating traps

The final safe tile now varies among nine central destinations. The choice uses the round's server-side seed and has no dependency on a player's identity. A destination can repeat by chance. The center remains one possible answer, and several players can still share the final island for a tie. There is still no pushing or jumping.

The useful design constraint was keeping a route through the remaining floor. Simply shuffling arbitrary tiles can split the arena into islands, and removing square-ring corners in an unlucky order can strand a tile behind two holes. I instead ordered removal by Manhattan distance from the chosen destination, shuffling tiles at the same distance. Each surviving tile retains an orthogonal route inward.

The normal first warning remains four seconds into play, every disappearing tile still warns for 1.8 seconds, and the default round remains 45 seconds. A 200-seed rule test checks all nine possible destinations, connected remaining floor, and an escape path within the warning's movement allowance. Those properties help make the change playable, but they do not measure fun or prove every player's reaction will be fast enough.

The old browser round test had an assumption that needed changing too: it walked two survivors to the center and left them there. The updated helpers use ordinary keyboard events to react to currently synchronized tile colors. They do not read the server's private future schedule. That lets the test continue proving eliminated recovery, late spectators, shared results and replay without depending on an obsolete game rule.

## One production process and one invitation origin

Local development still uses `npm start`. The new path is `npm run build`, followed by `npm run start:prod`. Vite bundles the browser files; the production process serves those files and Colyseus together. It does not expose the repository root or run a development server. Unknown API and source paths return errors instead of being swallowed by an HTML fallback.

The browser uses the page's origin for connections and invitations. Behind a host that terminates HTTPS, the SDK uses WSS for the game socket on that same origin. The production entry reads the provider port and binds all interfaces; its signal handlers close the service. Parties are still in memory. A restart, deployment or sleeping/restarted process cannot restore an old party or its scores.

The production bundle has no diagnostics panel, simulated-drop button, `window.__partyDebug` registration or Vite hot-reload connection. Normal recovery status stays visible. This distinction matters because testing only development mode would miss mistakes in the actual files sent to players.

The pilot also has proportionate limits: four total rooms, four reserved/connected seats per room, bounded HTTP/WebSocket traffic, bounded JSON/message sizes and deliberate browser-origin handling. Room creation checks its cap synchronously, so simultaneous requests cannot all pass an old count. Rate limits use the direct connection peer rather than trusting an arbitrary forwarded IP header; a hosting proxy can therefore share a budget across clients. These are small-pilot safeguards, not a claim of broad attack resistance.

## Waiting for a sleeping host without inventing a longer reservation

The earlier client treated short request failures as a local-server problem. That would be confusing on a free service waking after idle time. The client now retries readiness with a 90-second budget, short individual health/lookup requests, and clear cancel controls. It checks response shape as well as HTTP success, because a provider can return an HTML loading page where the app expects JSON.

Cancellation has to handle the pending socket as well as fetch. The pinned SDK has no initial-join cancellation API, so the implementation uses a small, documented application wrapper around its installed room factory to retire a pending connection. Operation guards prevent a late success from silently joining after cancellation. Existing protections for rotated credentials, retired-room retries, delayed health responses and page close remain in place.

Readiness waiting does not extend the two-minute seat reservation. The server still decides whether a returning credential is valid. A new server instance means the old party is gone; the client must explain that instead of suggesting that waiting longer can restore it. The app also cannot control a provider loading page shown before our HTML and JavaScript arrive.

## Phone input shares the existing movement path

The touch control is one fixed joystick with a small dead zone. Pointer capture keeps a drag attached to the control, and the first finger owns it until release or cancellation. An extra finger cannot take over. Touch and keyboard directions enter the same bounded input and prediction path, so neither input method gets a speed advantage.

Release, cancellation and lost capture stop the touch direction. Round transitions, elimination, disconnect, blur, page hide, visibility loss and resize clear all input sources. The interface adapts to portrait and short landscape layouts, includes safe-area padding, and offers a touch toggle for hybrid devices. Gesture suppression is limited to the joystick; scrolling, zoom and form editing remain available elsewhere.

Missing Web Locks now has its own secure-connection/supported-browser explanation. It no longer pretends that another tab owns the player when the browser cannot provide the feature. An ordinary HTTP address on a home LAN is not equivalent to HTTPS or loopback for this capability.

Browser emulation exercises layout and pointer-event paths. It does not establish that a real iPhone survives Safari suspension, that Android releases every physical gesture identically, or that switching between Wi-Fi and mobile data feels acceptable. Those remain explicit human/device acceptance work.

## Mistakes and lessons from this phase

### I allowed installation to overlap active tests on Windows

A dependency reinstall was started while parallel tests were still using `node_modules`. The Windows install/test processes then disagreed about which modules were present; one browser launch could no longer resolve `@playwright/test`. That was coordination failure in the work, not a game regression.

The repair was to stop the conflicting work, reinstall coherently, then resume verification. The intended Node 24.21.0 runtime was downloaded and its archive checked against the official SHA-256 before use. The install, production build and syntax checks then passed with that runtime.

**Lesson:** parallelize independent work, not mutation of the same dependency tree. `npm ci` removes and recreates dependencies; it must not race code that is loading them. On Windows, open module/native-library handles make that coordination particularly important.

### A touch test ended the wrong finger

A draft multi-touch test used the browser's CDP touch fixture incorrectly and ended the controlling finger while trying to release the extra one. That made it appear that the game mishandled a second finger. The fixture was corrected to represent the intended pointer sequence; the app was not changed to compensate for an invalid test gesture.

**Lesson:** establish what events the test actually emitted before changing input logic. Browser automation is another program with state and assumptions. A failing test is a reason to investigate, not proof of which program is wrong.

### The center-only test was encoding yesterday's game design

After the floor change, keeping everyone stationary at the center was no longer a valid survival strategy. Updating that setup preserved the acceptance purpose while removing an obsolete assumption. Reading the future server schedule would have made the test easier but would no longer resemble information available to a player; the helper instead follows visible warnings.

**Lesson:** keep tests about observable guarantees. A test can preserve the scoring/recovery contract while changing its setup as the game design changes.

## What was measured

The original seven Chrome/Edge acceptance cases passed after the floor-test adjustment, including repeated refresh, disconnect, eliminated rejoin, explicit leave during a scheduled retry, the delayed-health race, whole-browser reopen and actual server restart. The test profiles were isolated from everyday browser profiles.

Two automated touch/layout browser cases passed in 17.6 seconds, and four readiness/recovery browser cases passed in 8.3 seconds alongside 13 focused client-session unit tests. These results exercise browser emulation and deliberately controlled responses. They do not replace actual iPhone tests or measure Render's real cold-start screen. The final combined production run passed all eight browser cases plus two server/protection cases on Node 24.21.0; the focused suite passed 46 tests.

A transparent local TCP proxy added 50 ms or 125 ms to data in **each direction**. Because it forwards the upgraded connection too, the added 100/250 ms RTT applies to actual game WebSocket inputs, state patches and pings. This is different from slowing HTTP requests while leaving an existing socket untouched.

| Test condition | Observed result |
| --- | --- |
| 100 ms added RTT | HTTP sample 152.1 ms; game WebSocket ping 123.3 ms |
| 250 ms added RTT | HTTP sample 262.2 ms; game WebSocket ping 266.9 ms |
| Recovery under each delay | Three repeated interrupted/recovered connections kept identity and host-transfer rules; another recovery preserved elimination |
| Movement and scoring under delay | Duplicate sequence moved once; disconnected player stopped; result and points matched; scoring applied once; explicit leave released the seat |
| Ordinary two-minute expiry | Real default reservation remained present through 119 seconds, then expired 119,991 ms after the test observed the drop; old credential failed and a fresh identity joined |
| Built-server protocol and boundaries | Full round, result, recovery and replay passed; source/API boundaries, foreign HTTP/WS origin rejection, oversized/chunked bodies and forwarded-IP rate-limit resistance passed |

These figures are local samples with controlled added delay, not internet latency percentiles or a human assessment of game feel. The expiry test used the ordinary server default with real time and no shortened reservation or fake clock. The production protocol checks were rerun successfully under Node 24.21.0 after moving them into the separate production acceptance command.

`npm test` remains useful without a built site. Production checks are under `npm run test:production` after `npm run build`; `npm run test:expiry` is separate because its two-minute wait is intentional. The complete command results, additional touch/readiness/browser evidence and any later deployment results belong in the living verification record.

## The deployment boundary at this writing

The owner authorized the public source repository and the Free Render experiment. Read-only inspection of the approved Hobby workspace found no payment method, zero current shared usage, and four existing suspended services. No unrelated service or billing setting was changed. Account identifiers, email addresses and billing screenshots do not belong in this public journal.

The no-spend condition includes bandwidth and build usage, not merely a Free compute label. The reviewed plan uses the provider subdomain, one Free instance, manual deployments and normal idle sleep. It does not add a card, paid trial, database, domain purchase or keep-awake traffic. Shared quotas and future changes to account billing still need attention; the [deployment guide](../docs/deployment.md) records the checks and a manual stop threshold.

The service subsequently deployed successfully at **https://kottabos.onrender.com**, application revision `b66814ebca7ed1daf83519bd8622fd1e471d6774`, from the authorized public repository. Render built on Linux Node 24.21.0. A public Chrome/Edge smoke test passed over HTTPS/WSS in 39.8 seconds: invitation, host stability, repeated refresh recovery, round/results/replay and explicit leave. All local servers stopped; the Free service remains intentionally active with auto-deploys and previews off. Documentation-only updates do not trigger a new build.

The post-test billing display still showed no card and $0 charges. Its usage and service counters had not fully caught up, so it would be wrong to call the test's resource usage zero. The spending protection is the no-card suspension policy, not a rounded dashboard counter.

Actual iPhone compatibility and a friend on another network remain unverified. The next human session should compare two players, then four, include a phone and a different internet connection where possible, and pay particular attention to warning readability, control feel, returning after suspension and whether the varied floor makes another round worth playing. Record evidence in [verification](../docs/verification.md).
