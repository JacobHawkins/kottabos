# iPhone and family playtest

Actual iPhone and another person's remote-network tests remain manual acceptance. Desktop Chrome touch emulation is only layout/pointer evidence. iPhone Safari is the primary device target; record an iPhone Chrome run separately if used.

**First human result, September 19, 2026:** the owner played through the hosted service using a computer browser and a real phone, reported no problems, and liked it. Device/browser versions, networks and individual scenarios below were not recorded. This predates the twelve-player update. Keep this positive smoke test separate from the remaining twelve-person, cross-network and phone lifecycle checks.

## Invite and play

Open the deployed HTTPS URL, enter a nickname and create a party for **2–12 players**. Copy its invitation link and share it yourself. Friends open that link on their phones/computers, enter nicknames and join. Each browser profile/device is a distinct player. Open only one active game tab per profile. The host presses Start once at least two players are connected; there is no ready check. Find your number/color in the roster; your character also has a white ring and YOU label. Numbers stay the same through refresh/recovery, and a dropped player's seat counts toward twelve until released or expired.

Use WASD/arrows on a computer. On a phone, drag the thumb control and release to stop. Use the Touch controls toggle if detection is wrong. Portrait and landscape are supported without fullscreen. Every tile under a living player starts a 1.8-second warning, then falls. Leaving or revisiting never resets it. Keep moving onto unused tiles; there is no random pattern, safe final island or round deadline. A lone survivor earns three points; simultaneous final fallers tie for one each. The arena expands during play. The host chooses Play again; scores carry forward.

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
