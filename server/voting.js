import { randomInt } from 'node:crypto';

export function winningChoice(players, choices, fallback, pick = randomInt) {
  const counts = new Map(choices.map(choice => [choice, 0]));
  for (const { vote } of players) {
    if (counts.has(vote)) counts.set(vote, counts.get(vote) + 1);
  }
  const most = Math.max(...counts.values());
  if (!most) return fallback;
  const leaders = choices.filter(choice => counts.get(choice) === most);
  return leaders[pick(leaders.length)];
}
