# Journal 001: Building the first playable Kottabos

**Build date:** September 15, 2026  
**Written by:** the coding assistant that implemented this version  
**Scope:** milestones 1–3: setup, lobby, multiplayer, Stay on the Platform, scoring, replay, and recovery

This is an account of the work and the reasoning behind it, including assumptions I got wrong and problems that review caught. It is also a guide to learning game development through this particular project. The technical details describe the dependency versions installed for this build; they are not promises about every future release.

## When you come back to play

At the end of this work session, I stopped the development server and confirmed that the game port, 2567, and test ports, 2579 and 2580, had no listeners. Nothing needs to stay running between playtests. Your project files and installed dependencies remain in place.

Open PowerShell and run:

```powershell
cd C:\Users\JakeS\Documents\Projects\kottabos
npm start
```

Open [http://127.0.0.1:2567](http://127.0.0.1:2567) in Chrome and Edge. Create a party in one, join with its code in the other, ready up in both, and start the round from the host browser. Use WASD or the arrow keys. Keep the terminal open while playing; press **Ctrl+C** in it when finished.

You do not need to reinstall dependencies for every session. `npm ci` is for restoring the lockfile's dependency graph when needed, such as a fresh checkout without `node_modules`.

Because parties live in server memory, your next session begins with a new party. A message saying the previous party ended after restarting is expected. Browser recovery protects a temporary disconnect while the server remains alive; it does not save a party across server restarts.

The [README](../README.md) has the full walkthrough. For a short first playtest:

1. Join from both browsers and confirm the two names and colors.
2. Ready up, move around, fall, and compare results and scores.
3. Replay, then refresh one browser during the next round. Check that its identity survives.
4. Open **Local diagnostics** and use **Test a 3-second connection drop**. Watch the reconnecting message and the other browser's roster.
5. Refresh after elimination. You should still be spectating.
6. Leave as host and check that the other browser receives the controls.
7. Stop the server with Ctrl+C when done.

A single person switching between two browser windows can check these behaviors. That is different from two people judging whether a match is fun: keyboard focus means you are only controlling one window at a time.

## What I built, and why I started there

The folder initially contained the project brief. I treated its priorities as a guide to where the effort belonged: easy joining, reliable returning, responsive movement, then a complete small game. I kept the original brief intact.

The first version now has a complete loop: create a party, invite someone, ready up, play, see results, and play again. Players have recognizable colored placeholder characters. The server controls the floor, movement limits, elimination, round timing, winners, and cumulative scores. A new arrival during a round watches until the next one.

The technology choices each have a narrow job. Phaser draws the arena. Plain HTML and CSS handle the lobby and buttons. Node runs the server. Colyseus handles rooms, synchronized state, and the foundation of reconnection. Vite serves browser modules during local development. All project source is plain JavaScript; there is no TypeScript compilation step.

I separated the party from the minigame. The party remembers who you are and how many points you have. The minigame decides what happens on this round's floor. That means a future minigame can reuse joining and recovery without copying them. I stopped short of building a general game engine or an elaborate extension system: there is only one game to support so far.

I also separated the room code, player identity, and network connection. The code identifies which party to join. A server-generated player ID identifies whose score and character to preserve. A connection is temporary and can be replaced. A private recovery credential authorizes that replacement. Keeping those meanings separate is what lets a refresh restore the same player instead of creating someone new, while a public invitation code cannot claim another person's identity.

For movement, the server runs 30 fixed simulation steps each second and publishes updates at 20 Hz. The local browser previews your movement immediately and reconciles it with the server's confirmed position. Other players are drawn between recent received positions, slightly behind the latest server state, to make movement smoother. The shared movement function keeps the basic arithmetic consistent on both sides.

This separation is useful to understand early: what the player sees immediately can be a prediction, while the final result comes from the server. A responsive picture and a fair shared outcome are related problems, but they need different mechanisms.

## The mistakes and what they taught me

### 1. I assumed disabling hot reload would stop its connection

My first startup configuration disabled Vite hot reload. I expected that to remove the extra development connection and leave only the game socket. During browser testing, another WebSocket server still tried to use port 24678. When multiple test servers ran, that port conflicted.

I checked the installed Vite implementation and its official options, then disabled its WebSocket explicitly. That removed the port conflict, but the browser still reported `WebSocket closed without opened.` Disabling the server connection alone had not prevented the injected development client from trying to connect.

The final setup serves ordinary HTML directly through Express and loads CSS through a normal stylesheet link. Vite still transforms the JavaScript modules, but it does not inject that hot-reload client. A fresh browser smoke test then had no errors, and the complete suite passed without uncaught browser exceptions.

**What I learned:** a setting's name is not enough evidence of its behavior. Check the browser and server separately. A fix is complete when the observed failure is gone, not when the configuration looks convincing.

### 2. I treated reconnect events as more final than they were

Reading the installed Colyseus SDK showed that this version fires `onReconnect` before assigning the newly rotated reconnection token. Saving the token directly inside that callback could therefore save the old credential. The current connection could look healthy while the next refresh failed.

The client now saves the credential on the next microtask, after the current event-handling work finishes. That is a small timing adjustment with a large consequence for repeated recovery. I also set the SDK's minimum connection uptime to zero: its default otherwise excluded very early drops from automatic recovery.

These were dependency behaviors that needed application handling. The mistake to avoid was assuming that a successful first rejoin proved the entire recovery lifecycle.

Another discovered default allowed recovery credentials to replace an already active connection. That did not match our rule for a second browser tab. The browser now takes an exclusive Web Lock, and the server also rejects recovery while the existing owner is still connected. A duplicate tab gets an explanation instead of silently taking over. This is an example of choosing an explicit product behavior where a framework's default serves a different use case.

**What you can learn:** test the second and third repetition. “Refresh once” and “refresh repeatedly, reconnect, then close and reopen” exercise different risks. Event order and defaults are part of the behavior you are building on.

### 3. Turning off retries did not cancel a retry already waiting

My initial cleanup disabled automatic reconnection when leaving. Review of the SDK found a scheduled callback that could still run later: the timer did not recheck that setting before attempting to connect.

Imagine clicking Leave during the simulated three-second interruption. The screen could return home, then an old callback could quietly restore a connection behind it. That would violate the player's explicit choice.

The client now guards the transport retry method so a retired room cannot reconnect. It clears local recovery credentials on leave, and an authenticated HTTP request can release a reserved seat even when the game socket is down. A browser regression test leaves during the waiting retry and checks that no ghost player returns.

**What I learned:** cancellation has two parts: prevent future work from being scheduled, and make already scheduled work harmless. This applies to timers, animations, delayed attacks, loading screens, and almost any asynchronous game behavior.

### 4. A late health response could end a connection that had recovered

This was an application bug in my recovery logic. A health request could begin during a disconnect, then finish after automatic reconnection succeeded. Successful recovery cleared the deadline to `null`, but the old request could still compare the current time against that cleared value.

JavaScript permits this comparison:

```js
Date.now() >= null // true: null is converted to 0
```

That could make the old request declare a healthy connection expired. Checking that the room and operation were unchanged was insufficient: automatic reconnection can succeed within the same room object.

The fix also checks that the particular recovery deadline is still the same after the request finishes. A timing-specific browser test holds a health response until after reconnection, releases it, and verifies that the player stays connected.

Review found a related page-closing issue: closing the socket could run callbacks that initiated another rejoin while the page was leaving. The client now detaches the departing room before closing its socket and marks that page instance as closing.

**What you can learn:** after `await`, reconsider whether the operation is still relevant. The world may have changed while you were waiting. Tests that control when a response arrives can expose bugs that ordinary clicking rarely reproduces.

### 5. The order of game rules changed the meaning of a win

An early rules implementation checked movement and hazards before noticing that another participant had permanently left between simulation steps. If that departure left one survivor, and the survivor's tile disappeared on the next step, the code could award a one-person “tie” worth one point instead of the already-earned three-point win.

The fix checks whether there is already a sole survivor before applying the next movement and hazard step. A focused test covers that exact boundary, along with the case where every participant has left.

**What I learned:** rules need an order, not just a list. “Everyone falls together,” “the last opponent leaves,” and “the timer ends” can land very close together. Decide their meaning explicitly, then encode and test it. Otherwise, incidental code order becomes accidental game design.

### 6. Some failing checks were problems in the tests

The first expiry browser test could close a player before the host had observed that player's arrival. Its “player disappeared” condition was already true, so the test reopened too early. Waiting for the host to see both players established the missing starting condition.

Another draft test assumed that walking past the arena boundary would eliminate a character. Our actual rule clamps characters inside the arena; missing tiles cause falls. The test needed to move onto a tile and wait for its scheduled disappearance.

A rule/session test also needed to change the authoritative hazard schedule rather than write a temporary tile value that the next update would overwrite.

**What you can learn:** test setup is part of the test's logic. Establish the “before” state, cause one event, and observe the result. A failed test is evidence to investigate, not automatic proof that either the game or the test is wrong.

## How I approached learning and debugging

I used the brief to define player-visible guarantees, checked current official documentation, and compared it with the installed package versions when timing or behavior was unclear. I implemented small pieces, exercised them, and used independent review to challenge assumptions while other work continued. Several of the most valuable catches came from reviewing transitions rather than watching a successful round.

The pattern worth copying is:

1. Describe the symptom precisely: “leaving during a pending retry can reconnect a hidden player.”
2. State a hypothesis: “the existing timer ignores the disabled flag.”
3. Find evidence in the running program or relevant source.
4. Make the smallest change that addresses the cause.
5. Reproduce the original situation and verify the result.
6. Record the behavior in a focused regression test when it protects a meaningful guarantee.

This is why I kept rules independent of Phaser. We can test a simultaneous fall or a scoring boundary without constructing a browser scene. Browser tests then check the parts that only a browser can prove: keyboard events, page refresh, storage, lifecycle callbacks, and visible feedback.

At the end of the build, the checks passed: 20 tests as counted by Node (including the session parent test), and seven Chrome/Edge browser cases with no uncaught browser errors. A separate unaccelerated round reached 45 seconds of simulation time and gave both surviving clients the same tie result. The [verification record](../docs/verification.md) preserves the details and limits.

Those results support the tested behaviors. They do not establish that every race is impossible or that the game will feel good over the internet. The observed 60 FPS and roughly 1 ms local round trip were local spot measurements, not a benchmark of a remote match.

## Deliberate choices that still deserve playtesting

The safe center tile is an intentional simplification. Players can share it and tie; they cannot push each other. That makes the first complete game easy to reason about, but may make repeated rounds too predictable. A playtest should tell us whether the journey to safety creates enough interesting decisions.

Simple art, one minigame, keyboard-only controls, and in-memory rooms kept the project small enough to finish and examine. Those are scope choices. They become problems only if they prevent the experience we want next.

Recovery is limited to the same browser profile with its data intact, while the server still holds the seat. The full two-minute expiry wait was not timed end to end; automated tests used shorter reservations through the same code path. Actual remote play, sustained network delay/loss, mobile input, and human assessments of fun remain unverified.

## What I would focus on to become good at this

### Start with observation and game feel

My advice is to make the next session a playtest before making it a feature session. Notice whether you understand a warning, can tell which character is yours, and understand why you fell. Watch how long it takes to get back into a round. These details directly shape whether friends want another game.

Write concrete observations: “I noticed the warning only after I started moving,” or “I could not tell whether I had rejoined.” Then write a hypothesis and one small change to try. Change one variable at a time so you can learn what caused the difference.

### Learn a small amount of JavaScript deeply

For this codebase, focus on functions, objects, arrays and maps, modules, events, promises, and cleanup. Learn the difference between changing a value and creating a new object. Practice following what happens before and after an `await`.

You do not need to begin by understanding every reconnection branch. The movement code is a much smaller entrance. Being able to explain a 30-line function accurately will help more than vaguely recognizing every file.

### Build intuition for time and coordinates

Learn why movement is distance per second multiplied by elapsed time, why diagonal direction is normalized, and why drawing frames and simulation steps are separate. Then learn interpolation: drawing a position between two known positions.

At 150 pixels per second, one 1/30-second movement step is 5 pixels. That small example gives you something tangible to compare with the code and diagnostics. From there, prediction and reconciliation become easier to reason about.

### Make fairness explicit

Ask who decides each important fact. The server decides this game's winners and movement limits; the browser provides input and presentation. Learn to phrase guarantees such as “a disconnected character can still fall,” “a spectator cannot earn this round's points,” and “one round is scored once.”

These guarantees guide both design and tests. They are easier to maintain than a collection of special cases added after players find contradictory behavior.

### Practice small, explainable changes

Keep changes small enough that you can say what should happen before running them. Use version control to keep a known working point when you begin modifying the project. After a change, record what you expected, what happened, and what you would try next.

I would postpone a second engine, 3D conversion, accounts, elaborate artwork, and a pile of new minigames until you have played and adjusted this one. Completing and improving a small loop will teach you where the next investment actually belongs.

## A reading path and three experiments

Read these in order, at your own pace:

| Start here | Question to answer |
| --- | --- |
| [shared/constants.js](../shared/constants.js) | Which numbers control speed, timing, and arena size? |
| [shared/movement.js](../shared/movement.js) | How does a direction become a bounded position? |
| [server/minigames/stay-on-platform.js](../server/minigames/stay-on-platform.js) | How does the floor change, and when does a round end? |
| [tests/rules.test.js](../tests/rules.test.js) | How do we prove a tie or elimination rule? |
| [client/game.js](../client/game.js) | How are authoritative facts turned into a readable picture? |
| [client/controls.js](../client/controls.js) | How does a key become predicted movement and a server input? |
| [server/party-room.js](../server/party-room.js) and [client/session.js](../client/session.js) | What survives a connection change, and what must be cleaned up? |

For a first experiment, change `PLAYER_SPEED` in the shared constants from 150 to 120, then to 180. Restart the server after each change, create a fresh party, and compare how much control you feel you have on a tile. Keep notes, then restore the original value or keep a change for a stated reason.

For a second experiment, adjust the tile warning duration from 1,800 ms to 1,500 ms. Run `npm test`, restart the server, and play. Ask whether the added pressure is enjoyable or just harder to read. You are learning how a timing parameter affects player decisions, not merely trying to make the game difficult.

For a third experiment, improve warning readability in `client/game.js` without changing the server rules: try a stronger crack mark, border, or different pulse. Compare what you can recognize quickly. This teaches the distinction between making a rule harder and communicating that rule better.

Use `npm run check` for syntax and `npm test` for rules/session checks. When you change controls, lobby behavior, or recovery, `npm run test:browser` exercises the real browser flows too. After tests finish, your normal server still starts with `npm start`.

## Keep the next journal small

You can make a second entry after your playtest using this template:

```markdown
# Journal 002: First human playtest

## What I tried

## What I observed

## What surprised me

## My hypothesis

## One change to try next

## How I will tell whether it helped
```

You do not need a dramatic new feature to have a useful entry. Making movement easier to judge, a loss easier to understand, or rejoining less confusing is real game-development progress. The habit I would invest in most is connecting a player's experience to a specific change, checking the result, and keeping the lesson.

## References used in this build

The [architecture notes](../docs/architecture.md) record the exact versions and implementation decisions. For the relevant framework concepts, the build used [Phaser's official documentation](https://docs.phaser.io/), [Colyseus schema definitions](https://docs.colyseus.io/state/schema), [Colyseus reconnection](https://docs.colyseus.io/room/reconnection), [SDK connection lifecycle](https://docs.colyseus.io/sdk/connection), and [Vite server options](https://vite.dev/config/server-options). Start with the local code and consult the relevant documentation when you have a concrete question; you do not need to read every framework's manual before making your first small change.
