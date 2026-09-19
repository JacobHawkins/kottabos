# Browser Party Game — Project Brief

## Purpose

Build a browser-based multiplayer party game for friends and family, inspired by the short, chaotic minigames of Mario Party and Fusion Frenzy. The defining experience is fast joining, responsive play, painless leaving, and reliable rejoining.

This document records the agreed direction. It is a starting specification for the coding agent, not a claim that any implementation or setup already exists. The project owner will move it into a new project folder under Documents before development begins.

## Priorities, in order

1. Open a link and get into a party with minimal friction.
2. Refresh or briefly lose connection and return as the same player.
3. Responsive controls, consistent game results, and measurable performance.
4. A small playable game that proves the complete experience.
5. A understandable codebase that friends and family can help extend.
6. Expanded game design, artwork, characters, and additional minigames later.

The owner expects the coding agent to perform most setup, implementation, debugging, and verification. Keep local development easy to start and easy to diagnose. Human playtesting remains important for assessing fun and perceived responsiveness.

## Agreed technology direction

| Area | Initial choice |
| --- | --- |
| Project language | Plain JavaScript with ES modules |
| Browser game engine | Phaser, initially 2D/top-down |
| Server runtime | A supported Node.js LTS release |
| Multiplayer framework | Colyseus |
| Lobby and surrounding UI | Simple HTML/CSS and JavaScript |
| Initial session storage | Server memory |
| Collaboration | Git-ready repository; GitHub can be added later |

### Language constraint

Do not author TypeScript source, require a TypeScript compilation step for project code, or scaffold a TypeScript application. Use JavaScript configuration files wherever practical. Dependencies may internally use TypeScript; the agreed constraint concerns our own code and workflow. Colyseus examples often use TypeScript: adapt them to documented JavaScript APIs rather than copying their language setup.

### Why these choices

Phaser keeps the first experiment small and easy to inspect. Colyseus supplies game-oriented rooms, state synchronization, and reconnection mechanisms, reducing custom networking infrastructure. It does not automatically solve gameplay rules, prediction, latency, or every reconnection scenario.

Babylon.js remains an option if the owner later commits to 3D. Keep authoritative rules and networking independent of Phaser to preserve useful work, but do not promise that a 3D conversion will be trivial. Do not build two renderers or a generalized engine now.

Before installing dependencies, verify current stable releases, compatible Colyseus client/server/schema versions, and plain-JavaScript usage in official documentation. Pin the chosen dependency graph with a lockfile. Do not assume example APIs from different Colyseus versions are interchangeable.

## Initial scope

- Two to four players, one player per browser.
- Desktop browsers and keyboard controls first.
- Private parties reached by invitation link or short room code.
- A nickname and distinguishable colored placeholder character.
- One persistent party through repeated rounds.
- One minigame: **Stay on the Platform**.
- One authoritative server process, initially on the owner's computer.

Defer accounts, databases, public matchmaking, chat/voice, progression, monetization, mobile controls, custom character pipelines, multiple hosting regions, and large-scale infrastructure. Do not add React or another UI framework unless a concrete need justifies it.

## Player flow

Open invitation link → enter nickname → join lobby → ready up → play round → see results → play again.

The party creator receives start controls. This is a UI permission, not ownership of the game simulation. If that player leaves, the server gives start controls to another connected player and the party continues.

Joining must not require an account. A room code identifies the party; it must not be used as proof of ownership of a particular player identity.

## First minigame: Stay on the Platform

Use a small top-down arena with floor tiles that disappear after a visible warning. Players move to stay on safe ground. Falling eliminates a player for that round. Start with short rounds, approximately 30–60 seconds, and simple placeholder visuals.

The server decides movement validity, floor changes, eliminations, round timing, winners, ties, and scores. Both browsers must agree on results. Define tie and simultaneous-elimination behavior explicitly. Defer pushing, jumping, complex rigid-body physics, and elaborate animations.

A minimal state flow is lobby → countdown → playing → results → next round/lobby. Fresh players arriving during a round spectate until the next round.

## Rejoining is a core feature

| Event | Required behavior |
| --- | --- |
| Page refresh | Automatically attempt to return as the same player |
| Brief network interruption | Display a clear reconnecting state and retry automatically |
| Tab/browser closed and reopened | Offer or attempt rejoining using locally saved credentials while valid |
| Return after elimination | Restore identity and score; spectate until the next round |
| Party creator leaves | Party continues and start controls transfer |
| Explicit Leave Party | Exit promptly, release the active seat, and stop automatic rejoin |
| Expired reservation | Explain what happened and allow joining again if the party has space |
| Party ended or server restarted | Clearly explain that the session is unavailable and offer a new party |

Start with a configurable **two-minute reservation for unexpected disconnects**. This is a proposed default to tune through playtesting, not an indefinite reservation.

Implementation requirements:

- Keep player identity separate from a temporary network connection.
- Use Colyseus reconnection support plus the necessary application-level recovery flow.
- Save the appropriate room information and reconnection credential locally for reload/reopen recovery. Treat it as a credential; never put it in invitation URLs or routine logs.
- Reserve disconnected seats only for the configured period. Clean up expired reservations and unused rooms.
- Ensure repeated refreshes/retries do not duplicate players, listeners, scores, or input handlers.
- Define how a second tab using the same saved identity is handled; do not silently duplicate or take over players.
- Restore the current authoritative state, not an old local snapshot.
- Clear held movement inputs on disconnect. Disconnected characters remain subject to normal hazards; disconnecting never grants invulnerability or reverses elimination.
- Distinguish intentional leaving from a connection failure. Returning after an intentional leave can use the invitation flow; preserving the former seat/score is not required initially.
- Browser-local recovery applies to the same browser profile with its stored data intact. Cross-device identity recovery is outside the initial scope.

In-memory rooms will not survive a server process restart. Do not imply otherwise. Persistence and crash recovery are separate later features.

## Multiplayer and responsiveness foundation

- Run game rules on the server at a fixed simulation rate independent of browser rendering.
- Clients send inputs; the server validates them and decides authoritative results.
- Keep movement and simple collision rules in reusable JavaScript modules without browser or Phaser dependencies where useful.
- Provide immediate local movement with client prediction and reconcile against server state. Smooth other players using interpolation. Keep the implementation proportionate to this simple game.
- Clear movement on focus loss as appropriate so a player does not continue walking because a key-up event was missed.
- Bound input rates and validate incoming values, room membership, and start permissions.
- Keep the lobby and initial game download small.
- Add a development-only diagnostic display for frame rate, round-trip latency, connection/recovery status, and useful server timing measurements.
- Choose simulation and update rates intentionally, record them, and measure before optimizing. Do not promise zero lag.

Local two-browser testing demonstrates functionality, not real internet performance. Later testing must include delay, interruption, and a remote friend.

## Project organization and agent usability

Use a small, conventional structure separating browser code, server code, shared rules, and minigame code. Exact folder names are an implementation choice.

The shared party layer owns player identity, joining, reconnection, readiness, round transitions, and cumulative scores. Minigames own their rules, presentation, assets, and a small lifecycle such as start/update/finish/cleanup. Do not create an elaborate plugin framework for one minigame.

Deliver:

- One documented command to start the local client and server together.
- Clear prerequisites and commands in README.md, including Windows PowerShell examples.
- A committed lockfile, sensible .gitignore, and example environment configuration only if needed.
- Concise project-specific AGENTS.md guidance covering JavaScript-only source, authoritative rules, reconnect guarantees, and verification commands.
- Focused tests for game rules and session/reconnect behavior, plus useful logs without credentials.
- A short record of architectural decisions, known limitations, and next steps.

Future contributors should be able to work on a minigame or assets without rewriting party management. Avoid unnecessary services, Docker requirements, global tooling, or interactive logins for local development.

## Milestones and acceptance criteria

### 1. Local foundation

Create the JavaScript project, documented startup workflow, basic lobby, server room, invitation flow, and visible placeholder players. Verify two independent browser sessions can join the same room with different identities.

### 2. Complete playable round

Implement Stay on the Platform, countdown, eliminations, results, scores, and replay. Both clients show the same round and winner. Movement feels immediate locally and remote movement is smoothed.

### 3. Recovery acceptance

Verify the following explicitly:

1. Refresh during the lobby and during a round: same identity, no duplicates.
2. Briefly interrupt the connection: recover within the reservation period.
3. Close and reopen the client: recover the reserved player when credentials remain available.
4. Rejoin after elimination: remain eliminated until the next round.
5. Leave as party creator: other players continue and start controls transfer.
6. Explicitly leave: no unwanted automatic reconnect.
7. Expire a reservation or end a party: clear feedback and a usable next action.
8. Repeat recovery several times: no growing listener counts or duplicated actions.
9. Restart the server: show an understandable session-ended state.

### 4. Network feel and remote play

Use controlled artificial delay and interruptions, record what was tested, and distinguish frame-rate problems from network and server delays. Then select a small always-running host near the group, configure HTTPS/secure connections, and test with a remote friend. Public deployment and paid resources are later decisions; local setup does not authorize purchasing or publishing.

### 5. Expand after the foundation works

Use actual play to choose the next minigame and art direction. A second, different minigame should validate the shared party structure. Add persistence or broader platform support only when there is a demonstrated need.

## Initial implementation handoff

The accompanying kickoff prompt authorizes local setup, implementation, starting development servers, and focused runtime/browser tests for milestones 1–3. Do not stop after scaffolding if the playable acceptance criteria remain unfinished. Use simulated network tests where available; document remote play as pending until an actual remote connection is tested.

Inspect existing files and local instructions first. Preserve existing work. Proceed with routine reversible choices and document assumptions; ask only when a genuine blocker or material scope decision requires the owner. Do not create cloud resources, publish a repository, deploy publicly, purchase services, or start interactive login flows as part of the initial local implementation.

## Reference documentation

- Phaser: https://docs.phaser.io/
- Colyseus: https://docs.colyseus.io/
- Colyseus state synchronization: https://docs.colyseus.io/state
- Colyseus reconnection: https://docs.colyseus.io/room/reconnection
- Babylon.js, if a future 3D direction is selected: https://www.babylonjs.com/games/

These links are starting points. Verify current APIs and compatibility when implementing.
