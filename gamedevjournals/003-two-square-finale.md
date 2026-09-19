# Journal 003: Two squares, one last warning

September 19, 2026. After the successful computer/phone playtest, the owner asked for two final squares and a random choice that removes one. They also asked why the room limit is four and how far it could grow.

The floor now shrinks toward an adjacent pair chosen from twelve horizontal/vertical pairs in the central 3×3 area. It pauses with both safe for 2.5 seconds, warns one randomly selected square for the normal 1.8 seconds, then removes it. Keeping the squares adjacent lets a player react and cross over. Shared survival ties still exist; this change adds a decision near the end rather than forcing a winner.

The earlier removal order uses distance to the nearer member of the pair, independent of which eventually survives. Simply postponing the second-to-last removal in the old one-island pattern could reveal the survivor through earlier waves. A separate seeded random stream makes the final choice without using player identity or position; clients receive only the authoritative tile states.

Normal rounds keep their 45-second deadline and four-second opening. The final pair appears at 38.2 seconds, the warning begins at 40.7 and the chosen tile falls at 42.5. Short three-second test rounds cannot fit all these stages with a full warning, so they finish with two tiles safe. This preserves readable timing instead of silently making the last fall unavoidable.

Four players remains the current cap. It came from the initial scope, four spawns/colors and a small lobby presentation, not a framework connection limit. Eight is a useful next implementation/test target. Twelve or sixteen may be worth evaluating later, but neither is a measured capacity claim for the Free host. More players also need suitable spawn positions, distinguishable characters, readable mobile rosters and load/recovery evidence. The owner asked about that tradeoff without selecting a new cap, so it was not changed in this update.

Validation and the deployed revision are recorded in [verification](../docs/verification.md). The original brief and earlier journals remain historical records.
