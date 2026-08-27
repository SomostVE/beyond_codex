export function mergeAppendOnlyCards(previousCards = [], sourceCards = []) {
  const sourceIds = new Set(sourceCards.map(card => Number(card.id)));
  const retainedMissingFromSource = previousCards.filter(card => !sourceIds.has(Number(card.id)));
  return {
    cards: [...sourceCards, ...retainedMissingFromSource],
    retainedMissingFromSource
  };
}

export function mergeAppendOnlyDictionary(previous = {}, source = {}) {
  return { ...(previous ?? {}), ...(source ?? {}) };
}
