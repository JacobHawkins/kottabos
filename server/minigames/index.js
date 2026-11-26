import { createRound, updateRound } from './stay-on-platform.js';
import * as rope from './jump-rope.js';
import * as windup from './wind-up.js';
import * as runner from './dash-duck.js';

export const games = { platform: { createRound, updateRound, usesMaps: true }, rope, windup, runner };
