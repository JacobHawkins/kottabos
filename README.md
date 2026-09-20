# Kottabos

A small browser party game for **two to twelve people**. Create a private party, share its code, and let the host start a round on a floor that falls beneath your footsteps. The same party keeps its scores between rounds.

**Play:** [kottabos.onrender.com](https://kottabos.onrender.com). Open in desktop Chrome/Edge or iPhone Safari, create a party and share its invitation link. Use WASD/arrows or the touch joystick. The Free host can take about a minute to wake. The owner reported a successful computer + real-phone playtest with no problems; broader acceptance is tracked in [the playtest sheet](docs/playtest.md).

Built with Phaser, plain JavaScript ES modules, Node.js, and Colyseus. [PARTY_GAME_PROJECT_BRIEF.md](PARTY_GAME_PROJECT_BRIEF.md) preserves the initial specification; the owner subsequently expanded the shared party maximum to 12. Future minigames should reuse this party, recovery and score foundation. No TypeScript source or compilation workflow is used.

The September 20 update adds player-triggered floors, host-only starting, an expanded round view and animated LPC characters. GitHub protects `main` with required pull requests and passing `validate` checks, and Render deploys it after CI passes. See [verification](docs/verification.md) and the [initial release pull request](https://github.com/JacobHawkins/kottabos/pull/1) for checks and deployment evidence.

## Start locally

Prerequisite: Node.js **24.21.0**, pinned in `.node-version`, with npm. Local compatibility remains Node 22.12.0 or newer. The production build was also tested on Windows with the pinned Node 24 runtime. Use current desktop Chrome and Edge for the keyboard walkthrough; iPhone Safari is the real-device playtest target.

Dependencies are already installed in this workspace. Start the page and multiplayer server together:

```powershell
npm start
```

Open **http://127.0.0.1:2567**. Keep the terminal running. Press **Ctrl+C** to stop everything. This server binds to the local computer only; there is no cloud service or public deployment.

**Returning another day:** nothing needs to stay running between playtests. Open PowerShell in this project folder and run `npm start` again. Create a new party; stopping the server ends the previous in-memory parties. The [first development journal](gamedevjournals/001-first-playable-version.md) includes a short return-to-play checklist, a candid account of the build and its mistakes, and a learning path through the code.

For a fresh checkout, install the pinned dependencies first:

```powershell
cd C:\Users\JakeS\Documents\Projects\kottabos
npm ci
npm start
```

Always use the same origin, `http://127.0.0.1:2567`, for recovery. `localhost`, a different port, and a different browser profile have separate stored credentials.

## Play in Chrome and Edge

1. Open http://127.0.0.1:2567 in **Chrome**. Enter a nickname and click **Create a party**.
2. Copy the invitation link using the arrow next to the six-letter code. Open it in **Edge**, enter another nickname, and click **Join party**. Alternatively, open the main URL in Edge and enter the same code.
3. Each browser is a distinct player. Both names and colors appear in the party list and arena. A second tab in the same browser profile is blocked while its first tab is open. Separate browser profiles also work.
4. With at least two connected players, the current host clicks **Start round**. There are no ready checks. The arena expands for the countdown and round; lobby menus return with results. You can switch between the browser windows to control each character locally.
5. Move with **W A S D** or **arrow keys**. Click the arena first if the nickname field still has focus. Diagonal movement has the same speed. Switching away from the page clears held keys.
6. Every tile a living player stands on starts flashing amber for **1.8 seconds**, then disappears. The shrinking bar shows time remaining. Leaving or revisiting never resets its timer, and untouched tiles remain safe. A character falls when its center reaches a missing tile. The arena boundary is solid. Eliminated and late-arriving players spectate.
7. A lone survivor gets **3 points**. Players who fall together in the final simulation step tie for **1 point each**; earlier eliminated players and spectators get none. There is no round deadline: keep moving until only one player remains or the last players fall together.
8. Both browsers receive the same result and cumulative score. The host clicks **Play again** to return everyone to the lobby. The host can start the next round immediately once two players are connected.

Your routes create the floor pattern. Starting tiles begin their timers when play begins, after the countdown. Every tile can fall, including the center; there is no random removal, protected final island or timed wave. Players can share tiles, but sharing never extends a timer. There is no pushing or jumping.

On phones, use the thumb joystick: drag to move, release to stop. The **Touch controls** toggle also works on hybrid devices. Rotation, canceled gestures, loss of focus and reconnection clear input. Normal scrolling and zoom remain available outside the control. Use the hosted **HTTPS** invitation: plain HTTP on a LAN address does not supply the secure browser features used to guard duplicate tabs.

The first player keeps host controls when others join. A refresh/drop/leave transfers those controls to a connected player; rejoining does not take them back. The current host is named in the party interface. This permission never changes simulation authority: positions, floor hazards and scoring are settled by the server.

## Character artwork

All players now use the supplied Universal LPC character sheet: four-direction walking, gentle idle animation and a fall animation. Colored ground markers and number badges distinguish players; your character keeps the white ring and YOU label. The original PNG is stored unchanged in `client/assets/character-spritesheet.png`. The renderer uses its 64×64 cells and anchors the feet to the authoritative position. Motion respects the browser’s reduced-motion setting, and refresh/reopen after elimination restores a fallen pose without replaying the fall. Sprite art does not change movement speed, collision or the center-point floor rule.

The footer links the generator’s full contributor/asset credits and license information; [asset provenance and frame mapping](client/assets/README.md) records the source. The roughly 318 KiB sheet loads once after joining. The larger credits CSV downloads only when clicked.

Music, effects and voice lines can be tied to movement, tile collapse, elimination, victory or round transitions. Phaser supports this, but audio remains disabled in the current game and no audio files were supplied with this update. A future audio pass should unlock playback after a click/tap, provide mute/volume controls, and play authoritative event sounds once without replaying them on recovery.

## Build and serve production

```powershell
npm ci --include=dev
npm run build
npm run start:prod
```

Open `http://127.0.0.1:2567` for a local production check. The production entry binds `0.0.0.0` and reads `PORT`; it serves built assets and game endpoints without Vite or development controls. `npm start` still runs local development on loopback. Stop either with Ctrl+C.

One Free Render service is described in [render.yaml](render.yaml). Its connected GitHub source, `main` branch and **After CI Checks Pass** setting were verified in Render on September 20. It was created through the dashboard, so changing this YAML alone does not update it. Read [deployment setup, $0 conditions and service operations](docs/deployment.md). Current public URL/revision and actual acceptance results belong in [verification](docs/verification.md).

## Develop, test and release

1. Work on `codex/test`, run the relevant local checks, then commit and push that branch. This runs GitHub CI without deploying the game.
2. Open a pull request from `codex/test` into `main`. The protected main branch requires the **`validate`** check to pass before merging.
3. Merge when the update is ready for players. The new `main` commit runs CI again; Render builds and deploys it automatically after all checks pass. Check the Render deployment result before treating the update as live.

[CI](.github/workflows/ci.yml) checks JavaScript, rules/session recovery, twelve-player play, Chrome/Edge gameplay and sprites, then builds and tests the production app. It uses the pinned Node version, a standard free GitHub runner for this public repository, and no paid resources, persistent caches or artifact uploads. Phone emulation does not replace real-device testing.

`codex/test` is a development branch with automated tests; it has no separate hosted game. Keep the single Free Render instance and its no-card safeguard. Merge releases between play sessions because deployments end in-memory parties and scores. After a release, merge the latest `origin/main` back into `codex/test` before the next change. See the [phone/family playtest guide](docs/playtest.md) for live checks.

## Refresh, disconnect, and rejoin

| Try this | Expected result |
| --- | --- |
| Refresh in the lobby or during play | Automatically restores the same identity, score, and current authoritative state; no second player is created. |
| Open **Local diagnostics**, then **Test a 3-second connection drop** | The actual game socket closes and retries after three seconds. A reconnecting badge appears; the other browser sees a reserved seat. Movement stops, but hazards continue. |
| Briefly interrupt the browser's network | The client detects a closed or stalled connection, displays recovery status, and retries automatically. The local drop button is the most reproducible local test. Turning off Wi-Fi alone does not interrupt loopback traffic. |
| Close a tab, then reopen this URL in the same profile | Saved credentials recover the reserved player while valid. Closing and reopening the whole browser works if its stored local data remains intact. |
| Refresh after elimination | Identity and score return; the player stays eliminated until the next round. |
| Refresh, disconnect, or leave as host | Start/replay controls transfer to another connected player. Rejoining does not take those controls back. |
| Click **Leave party** | Stops automatic retries, clears recovery credentials, and releases the seat. This also works during a simulated socket drop via an authenticated HTTP request. If the entire network is unreachable, the server releases the seat at expiry. |
| Return after the reservation expires | Explains that the seat or party is unavailable and lets you join by code as a new player, if there is room, or create a new party. |
| Stop and restart `npm start` | Existing in-memory parties and scores are gone. Clients explain that the previous session ended and offer a new party. |

Unexpected disconnects reserve seats for **two minutes**, counted from server-side detection. Reserved players count toward the twelve-player limit. Each occupied seat has a distinct color and stable number (01–12), preserved through recovery. Nicknames and room codes are not recovery credentials. Recovery uses a separate rotating secret saved only in that browser profile; it never appears in invitation links or routine logs. Clearing site data or using a different browser loses that identity.

Startup waits up to 90 seconds for a slow/waking host, using short health attempts. You can cancel joining or rejoining immediately. This wait does not extend an existing seat reservation or resurrect a party after restart. Render can show its own loading screen before our page loads; app feedback begins only afterward.

To exercise reservation expiry quickly, stop the server, then start with a five-second reservation:

```powershell
$env:RECONNECT_SECONDS = '5'
npm start
```

Create a party in Chrome, keep Edge connected, close Chrome's party tab for more than five seconds, then reopen. To restore the default, stop the server and run:

```powershell
Remove-Item Env:RECONNECT_SECONDS
npm start
```

## Verification and diagnostics

```powershell
npm run check
npm test
npm run test:browser
npm run build
npm run test:production
npm run test:twelve
npm run test:expiry
```

- `check` checks syntax for all project JavaScript and rejects project TypeScript source.
- `test` runs focused rules, input, recovery and real local HTTP/WebSocket session tests, including 100/250 ms added socket RTT. These do not require the development server.
- `test:production` verifies the built server and browser flows (build first); `test:expiry` separately spends the full ordinary 120-second reservation wait.
- `test:twelve` runs twelve independent SDK players through capacity, recovery, simultaneous movement, a full round and replay on its own local server (port 2584). Setting `PLAYTEST_URL` explicitly targets an authorized HTTPS deployment instead; it creates one temporary party and leaves afterward.
- `test:remote` requires an authorized HTTPS `PLAYTEST_URL` and checks the basic Chrome/Edge loop plus the twelve-player browser layout/recovery case. It uses temporary isolated test players.
- `test:browser` launches installed **Chrome and Edge** in headless mode, starts its own server on port **2579**, and uses a separate port **2580** for restart testing. It does not control your everyday browser profiles. Keep those ports free. Playwright is included; no global tooling or interactive login is needed. Browser overrides `TEST_HOST_BROWSER` and `TEST_GUEST_BROWSER` are available, but record any change from two different browsers.

Browser tests accelerate countdowns and reservation expiry. Normal gameplay defaults stay unchanged. See [docs/verification.md](docs/verification.md) for the recorded results and what remains unverified.

The development-only **Local diagnostics** panel displays frame rate, application ping round-trip latency, recovery status, simulation callback cost, pending inputs, and listener/scene counts. Movement is simulated at **30 Hz**, sent as **20 Hz** state patches, predicted locally, and interpolated for remote players with a **100 ms** display delay. These measurements are for diagnosis, not an internet performance guarantee.

## Development and troubleshooting

One Node process runs Colyseus and the Vite middleware on the same origin and port. Hot reload is intentionally disabled so a file edit does not interrupt a party or compete for the game WebSocket. Refresh after browser edits. Restart `npm start` after server/shared-rule edits; restarting clears all parties.

| Symptom | Next action |
| --- | --- |
| Port 2567 already in use | Stop the previous process, or set `$env:PORT = '2568'` before `npm start` and open that printed URL. |
| Party full | Twelve connected or reserved seats are occupied. Have someone leave explicitly or wait for expiry. |
| Another tab is active | Use that tab, close it and click **Try this tab again**, or use a different browser/profile for a second player. |
| No movement | Wait for the round, use WASD/arrows or enable Touch controls and drag. Eliminated players and spectators cannot move. |
| Reconnecting persists | The host may be waking or unavailable. Cancel if needed; after expiry, join again or create a new party. |
| Browser needs secure features | Use HTTPS and a current browser with Web Locks. An ordinary HTTP LAN URL is not equivalent to loopback testing. |
| Browser tests cannot launch | Install desktop Chrome and Edge, or explicitly configure available Playwright browser channels. No browser download is needed on the verified machine. |

Environment settings are optional: `PORT` (default 2567), `RECONNECT_SECONDS` (120, positive up to 600), and `COUNTDOWN_MS` (3000). Configuration is trusted server-side only; a joining player cannot change it. No `.env` file is required or loaded automatically.

Source: [JacobHawkins/kottabos](https://github.com/JacobHawkins/kottabos), with development on `codex/test` and releases on `main`, published with the owner's authorization. Layout and decisions are in [docs/architecture.md](docs/architecture.md); contributor instructions are in [AGENTS.md](AGENTS.md). The lockfile and original brief are preserved.

The phase specification is [instructions/NEXT_MILESTONES_WEB_AND_MOBILE.md](instructions/NEXT_MILESTONES_WEB_AND_MOBILE.md); implementation evidence and pending human/device checks are in the verification record.

## Current boundaries

This prototype has one minigame, keyboard/touch controls, animated LPC characters and proportionate pilot request/room limits. Parties live only in server memory. There are no accounts, cross-device recovery, audio or crash persistence. Free hosting can sleep, restart or suspend at quota exhaustion.

The first hosted computer + real-phone playtest passed by owner report. Twelve-person play, network switching/background suspension, and a friend on another network remain pending. Automated twelve-client checks, browser emulation and owner-reported experience are recorded separately. Use [the playtest sheet](docs/playtest.md) for broader coverage.
