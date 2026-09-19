# Journal 004: A party of twelve

September 19, 2026. The owner chose twelve as the shared maximum for the current game and future games, with this update as the stopping point for today's development. The original brief remains intact as a record of the four-player starting scope.

The party limit now lives in the shared `MAX_PLAYERS` constant at twelve. Colyseus admission, the server's reserved-seat check, the public party lookup and the client counter consume that limit. Two-minute recovery still reserves identity, color, number and score. A thirteenth new identity is refused even if one of the twelve players is temporarily disconnected; valid recovery can still fill its own reserved seat.

Stay on the Platform adds eight starts to the original four corners, forming a symmetric inset perimeter. All twelve start on distinct tile centers, at least 64 pixels apart, outside the possible final squares. The two-square finale, movement speed, warning timing, shared survival ties and server-authoritative results remain intact.

Twelve colors are backed by stable numbers 01–12, derived from the reserved color slot. The lobby has four columns and three rows. During play, the roster carries full names while the arena shows numbers, keeping name plates from covering the floor. A local white ring and YOU label help each player follow their own character. Ready/start/replay controls come before the longer roster, and awards wrap on phones. Screenshot review found that the old long lobby banner covered the bottom row in short landscape; it was shortened and the browser test now checks that it sits below the characters.

Tests use twelve independent SDK sockets to play a complete round from synchronized visible warnings, and two browser applications plus ten SDK sockets to inspect the full roster, character rendering and phone layouts. Those checks exercise actual admission, recovery, movement, scoring, replay and host transfer. They do not substitute for twelve people on real phones or establish capacity for four simultaneous full parties. The existing Free service and four-room process cap remain in place; no hosting upgrade is part of this change.

Future work should start with human play and use it to choose another minigame or visual direction. Keep the twelve-player party, recovery and cumulative-score foundation when replacing or adding gameplay. Do not build a generalized game framework before a second game demonstrates the need.

Commands, results, measured observations and the deployed revision belong in [verification](../docs/verification.md). The family sheet now includes full twelve-person play and recovery at capacity.
