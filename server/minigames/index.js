import { createRound, updateRound } from './stay-on-platform.js';
import * as rope from './jump-rope.js';

export const games = { platform: { createRound, updateRound, usesMaps: true }, rope };
