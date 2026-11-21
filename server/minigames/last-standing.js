export function livingIds(state, round) {
  return round.participantIds.filter((id) => {
    const player = state.players.get(id);
    return player?.participating && player.alive;
  });
}

function nameList(state, ids) {
  return ids.map((id) => state.players.get(id)?.name || 'Player').join(' & ');
}

/** Decide one result. Scores are deliberately awarded only by the party layer. */
export function finishRound(state, round, reason = 'round-ended') {
  if (round.outcome) return round.outcome;
  const survivors = livingIds(state, round);
  let winnerIds = survivors;
  let awardedPoints = survivors.length === 1 ? 3 : 1;
  if (reason === 'simultaneous-elimination') {
    winnerIds = round.lastEliminatedIds.filter((id) => state.players.has(id));
    awardedPoints = 1;
  }
  let resultText = 'Round ended. No points awarded.';
  if (winnerIds.length === 1 && awardedPoints === 3) {
    resultText = `${nameList(state, winnerIds)} wins! +3 points`;
  } else if (winnerIds.length > 0) {
    const winners = winnerIds.length > 3 ? `${winnerIds.length} players` : nameList(state, winnerIds);
    resultText = `${winners} tie! +1 point each`;
  }
  round.outcome = {
    winnerIds: [...winnerIds],
    pointsByPlayer: Object.fromEntries(winnerIds.map((id) => [id, awardedPoints])),
    reason,
    resultText,
  };
  return round.outcome;
}
