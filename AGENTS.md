# Kottabos contributor guidance

Read PARTY_GAME_PROJECT_BRIEF.md as the product specification. Preserve it.

The owner expanded the original scope to **2–12 players** after the first hosted playtest. Treat twelve as the shared party maximum for the current game and future minigames; preserve identity, recovery, host start controls and scores when adding or replacing a minigame. The owner subsequently removed player readiness and replaced scheduled floor waves with irreversible timers on tiles occupied by living participants. The original four-player brief remains a historical starting specification.

- Project source and configuration use plain JavaScript ES modules. Do not add TypeScript or a TypeScript compilation workflow.
- Keep browser rendering in client/, party/session management in server/, game rules in server/minigames/, and dependency-free movement in shared/.
- The server decides movement limits, floor hazards, elimination, winners, and scores. Clients send bounded inputs and predict presentation only.
- Unexpected disconnects reserve identity and score for 120 seconds by default. Use Colyseus recovery hooks, persist rotated credentials, and distinguish explicit leave. Never log reconnection credentials or include them in invitation URLs.
- Preserve same-browser refresh/reopen recovery and the single-active-tab guard. Rejoin restores authoritative state, including elimination; disconnected characters remain vulnerable.
- Use npm start for the local client and server. npm run check checks project JavaScript syntax. npm test runs focused rule/session tests. npm run test:browser exercises real browser flows. Runtime and browser validation are authorized. The owner authorized the GitHub-to-Render release workflow below; purchases and additional hosting resources still require a separate instruction.
- Verify official docs and installed APIs before changing Colyseus/Phaser versions. Commit package-lock.json with dependency changes.
- `npm run build` bundles public assets; `npm run start:prod` serves them with Colyseus. Build before `npm run test:production`. `npm run test:expiry` waits the full 120-second reservation; run it deliberately. Never run dependency reinstalls while local test/server processes are using native modules.
- Develop and test on `codex/test`. Push that branch for CI, then open a pull request into `main`. Require the `validate` check before merging; do not bypass branch protection or push development work directly to `main`. A merge to `main` starts CI again, and Render deploys the new main revision only after its checks pass. See docs/deployment.md for dashboard setup and docs/verification.md for observed remote state.
- The web/phone scope is defined by instructions/NEXT_MILESTONES_WEB_AND_MOBILE.md. The owner's September 20 instruction replaces its manual-only deployment policy with the tested-main release workflow. Keep strict $0 hosting safeguards and one process/instance; `codex/test` has no hosted service or preview deployment. Real iPhone and remote-person tests require actual device/person evidence; emulation is not acceptance.
- Update README.md and docs/ when changing controls, startup, recovery behavior, or architecture. Keep tests about observable guarantees.
