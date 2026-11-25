# iPhone and family playtest

Actual iPhone and another person's remote-network tests remain manual acceptance. Desktop Chrome touch emulation is only layout/pointer evidence. iPhone Safari is the primary device target; record an iPhone Chrome run separately if used.

**First human result, September 19, 2026:** the owner played through the hosted service using a computer browser and a real phone, reported no problems, and liked it. Device/browser versions, networks and individual scenarios below were not recorded. This predates the twelve-player update. Keep this positive smoke test separate from the remaining twelve-person, cross-network and phone lifecycle checks.

## Invite and play

Open the deployed HTTPS URL, enter a nickname and create a party for **2–12 players**. Copy its invitation link and share it yourself. Friends open that link on their phones/computers, enter nicknames and join. Each browser profile/device is a distinct player. Open only one active game tab per profile. The host presses Start once at least two players are connected; there is no ready check. Find your number/color in the roster; your character also has a white ring and YOU label. Numbers stay the same through refresh/recovery, and a dropped player's seat counts toward twelve until released or expired.

Use WASD/arrows on a computer. On a phone, drag the thumb control and release to stop. Use the Touch controls toggle if detection is wrong. Portrait and landscape are supported without fullscreen. Every tile under a living player starts a 1.8-second warning, then falls. Leaving or revisiting never resets it. Keep moving onto unused tiles; there is no random pattern, safe final island or round deadline. A lone survivor earns three points; simultaneous final fallers tie for one each. The arena expands during play. Vote for 1, 3 or 5 rounds when the host begins. In longer sessions, vote on a map before each later tile round. The host can return everyone to the lobby after the final result, with party scores carried forward.

For Jump Rope, have the host select it in the lobby. Try one round with at least three people. Jump with Space on desktop and a tap on a phone. Let one player miss three times, then have them pull each swing while the others jump. With four or more people, let two players work the handles together. Check that you can see the approach on your phone, that the coming swing speeds up, and that a handle player who refreshes returns to the same role.

The server settles positions, falls, winners and scores. Your own player is predicted locally; other players are interpolated with 100 ms display delay in addition to network travel. Slight screen differences do not create multiple game outcomes. Test feel on the actual route before judging fairness solely from one screen.

The original host keeps controls through later joins. Refreshing, losing connection or leaving transfers controls to the earliest remaining connected player; returning does not take them back. The current host is named on screen.

These player-triggered floors, character visuals and expanded round layout are local changes pending a new deployment and human playtest. Earlier hosted acceptance does not verify them.

## Acceptance sheet (owner fills in)

Record date, service revision/region, phone model, iOS version, browser, approximate location/network, player count and observations. Start with two people, then try a full twelve-person party. Include one person on a different internet connection and a keyboard player if available.

| Check | Evidence / pass / defect |
| --- | --- |
| First visit after >15 minutes idle | Provider loading screen and elapsed wait; client wait/cancel feedback once loaded |
| Portrait and landscape | Arena, thumb control, host start/replay, scores and nickname keyboard usable |
| Movement and stopping | Release outside control, extra finger, canceled gesture, rotation; no stuck movement |
| Shared loop | Everyone sees same floor, elimination, results, cumulative score and replay |
| Full twelve-person party | Distinct numbers/colors, readable phone roster, 12 starting positions, thirteenth join refused |
| Recovery at capacity | Refresh/drop at twelve restores the same identity and score without an extra seat |
| Refresh repeatedly | Same identity/score, no duplicate roster entry |
| Switch apps / lock screen | Input clears; return recovers while reservation remains |
| Switch Wi-Fi ↔ cellular | Same identity if valid; correct expiry if delayed too long |
| Drop on dangerous floor | Character still falls; return cannot revive it |
| Host disconnect/leave | Connected player receives controls, returning host does not reclaim |
| Leave during retry | Retry stops immediately; no ghost return |
| Human feel | Comfortable movement, readable warnings, enjoyable variety; note delay separately from FPS |
| End session | Leave Party and close tabs; check usage below stop thresholds |

Two-minute reservations begin when the server detects disconnection. Background browsers may be suspended; they do not continue simulating locally or keep seats forever. Rejoining requires the same profile and retained site data. A server restart or idle shutdown loses all parties/scores. Cross-device identity transfer is outside scope.

## November expansion playtest

Try 3-, 5- and 10-round sessions and select each new game in the lobby. Record the player count, devices/browsers and whether participants used separate networks.

- Jump Rope: compare repeated taps with the previous jump. The new 300 ms jump can restart immediately on landing. Check whether the shorter safe window still feels fair.
- Wind-up Rally: use touch and Space; compare fast and slow tapping, watch the toys travel different distances, and confirm the farthest gets +1. Refresh during winding and during the race.
- Neon Trails: steer early, test your own and other players' trails and an edge. Once eliminated, move the eraser and clear a path for a survivor. Check how twelve starting lanes feel.
- Maze Munch: compete for dots, use a power star to catch a ghost, and take three ghost hits. Check that the highest collected score wins even if that player was eliminated.
- Dash & Duck: jump orange hurdles and duck purple bars. After three dings, aim at another runner and stun them. Check that the shot cooldown and target protection feel fair.
- Bomb Garden: escape your own fuse, break crates, collect both upgrades, and try a chain reaction. Once eliminated, repeatedly request random bombs and check the visible fuse gives survivors a chance to escape.
- Refresh or briefly disconnect in each game, including every post-elimination role. Identity, party/session points and elimination must persist. Try joystick movement with a second finger on the action button, then rotate the phone.

Current automated phone checks use Chrome touch/viewport emulation. New-game balance, physical iPhone Safari, real network input latency and a family playtest remain human acceptance work.
