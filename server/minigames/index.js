import { createRound, updateRound } from './stay-on-platform.js';
import * as rope from './jump-rope.js';
import * as windup from './wind-up.js';
import * as trails from './neon-trails.js';
import * as maze from './maze-munch.js';
import * as runner from './dash-duck.js';
import * as bombs from './bomb-garden.js';

export const games = { platform: { createRound, updateRound, usesMaps: true }, rope, windup, trails, maze, runner, bombs };
