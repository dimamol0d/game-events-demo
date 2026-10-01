import { normalizePreferences } from './model.mjs';

const key = gameId => `game-events:ui:v1:${gameId}`;

export function readLocalState(storage, gameId) {
  try {
    const raw = JSON.parse(storage.getItem(key(gameId)) || '{}');
    return { preferences: normalizePreferences(raw.preferences),
      lastVisit: typeof raw.lastVisit === 'string' && Number.isFinite(Date.parse(raw.lastVisit)) ? raw.lastVisit : null };
  } catch {
    return { preferences: normalizePreferences(null), lastVisit: null };
  }
}

export function writeLocalState(storage, gameId, state) {
  try {
    storage.setItem(key(gameId), JSON.stringify({
      preferences: normalizePreferences(state.preferences), lastVisit: state.lastVisit,
    }));
    return true;
  } catch {
    return false;
  }
}
