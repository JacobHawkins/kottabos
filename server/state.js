import { schema, t } from '@colyseus/schema';

// The schema builder runs directly in JavaScript: no decorators or compilation.
export const PlayerState = schema({
  id: t.string().default(''),
  name: t.string().default(''),
  color: t.string().default('#ffffff'),
  x: t.number().default(0),
  y: t.number().default(0),
  alive: t.boolean().default(false),
  participating: t.boolean().default(false),
  ready: t.boolean().default(false),
  connected: t.boolean().default(true),
  score: t.number().default(0),
  roundPoints: t.number().default(0),
  lastInputSeq: t.number().default(0),
}, 'PlayerState');

export const PartyState = schema({
  code: t.string().default(''),
  hostId: t.string().default(''),
  phase: t.string().default('lobby'),
  round: t.number().default(0),
  phaseEndsAt: t.number().default(0),
  roundElapsedMs: t.number().default(0),
  tiles: t.array('uint8'),
  players: t.map(PlayerState),
  resultText: t.string().default(''),
  winnerIds: t.array('string'),
  serverTime: t.number().default(0),
  stepMs: t.number().default(0),
  tick: t.number().default(0),
}, 'PartyState');
