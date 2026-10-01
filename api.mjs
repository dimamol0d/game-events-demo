import { fromSnapshot } from './model.mjs';

export async function loadLaboratory(gameId, fetcher = fetch) {
  const response = await fetcher('/api/snapshot?limit=100', {
    signal: AbortSignal.timeout(7000), headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error('Лаборатория не отвечает. Запусти обычные мониторы и повтори загрузку.');
  return fromSnapshot(await response.json(), gameId);
}
