import { supabase } from '../lib/supabase';
import { isBackendMode } from '../config/backendMode';
import { commitStateToBackend } from '../api/backend/commit';

/**
 * Per-character game save storage.
 * Primary: Supabase `game_saves` table (keyed by character_id).
 * Fallback: localStorage (offline mode).
 *
 * Conflict resolution: newest `updated_at` wins.
 *
 * ⚠️ Tryb backendu (isBackendMode): serwer Laravel jest JEDYNYM zapisującym do
 * `game_saves`. Klient trzyma wtedy tylko lokalny cache (localStorage) i NIE
 * wysyła bloba do Supabase — inaczej nadpisywałby autorytatywny stan serwera
 * po każdej akcji i zostawiał otwartą furtkę cheatera (bezpośredni zapis PostgREST).
 */

const localKey = (characterId: string): string =>
  `dungeon_rpg_save_char_${characterId}`;

interface ILocalSave {
  state: Record<string, unknown>;
  updated_at: string;
}

// -- Save --------------------------------------------------------------------

export const saveGame = async (
  characterId: string,
  state: Record<string, unknown>,
): Promise<void> => {
  const now = new Date().toISOString();
  const payload: ILocalSave = { state, updated_at: now };

  // Always save to localStorage (instant, works offline)
  try {
    localStorage.setItem(localKey(characterId), JSON.stringify(payload));
  } catch {
    // storage full – silently skip
  }

  // Tryb backendu: serwer jest jedynym zapisującym do game_saves. Nie pisz bloba
  // wprost do Supabase — zamiast tego wyślij autorytatywny commit do backendu
  // (serwer waliduje realną mocą z gearu i zapisuje). Zamyka furtkę PostgREST.
  if (isBackendMode()) {
    await commitStateToBackend(characterId);
    return;
  }

  // Try to save to Supabase (online)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from('game_saves')
      .upsert(
        {
          user_id: session.user.id,
          character_id: characterId,
          state,
          updated_at: now,
        },
        { onConflict: 'character_id' },
      );
  } catch {
    // offline or error – localStorage already has the data
  }
};

// -- Load --------------------------------------------------------------------

/**
 * Load game state for a character.
 * Tries Supabase first; if cloud is newer it wins, otherwise localStorage wins.
 * Returns null if no save exists anywhere.
 */
export const loadGame = async (
  characterId: string,
): Promise<Record<string, unknown> | null> => {
  let cloudState: Record<string, unknown> | null = null;
  let cloudUpdated = 0;

  // Try loading from Supabase
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data } = await supabase
        .from('game_saves')
        .select('state, updated_at')
        .eq('character_id', characterId)
        .maybeSingle();

      if (data) {
        cloudState = data.state as Record<string, unknown>;
        cloudUpdated = new Date(data.updated_at).getTime();
      }
    }
  } catch {
    // offline or no data – fall through
  }

  // Load from localStorage
  let localState: Record<string, unknown> | null = null;
  let localUpdated = 0;

  try {
    const raw = localStorage.getItem(localKey(characterId));
    if (raw) {
      const parsed: ILocalSave = JSON.parse(raw);
      localState = parsed.state;
      localUpdated = parsed.updated_at ? new Date(parsed.updated_at).getTime() : 0;
    }
  } catch {
    // corrupt data
  }

  // Conflict resolution: newest wins
  if (cloudState && cloudUpdated >= localUpdated) {
    // Also update localStorage with the cloud version
    try {
      localStorage.setItem(
        localKey(characterId),
        JSON.stringify({ state: cloudState, updated_at: new Date(cloudUpdated).toISOString() }),
      );
    } catch {
      // storage full
    }
    return cloudState;
  }

  if (localState) {
    return localState;
  }

  return cloudState;
};

// -- Sync to Cloud -----------------------------------------------------------

/**
 * Push localStorage data to Supabase for a specific character.
 * Called on reconnect or periodic sync.
 */
export const syncToCloud = async (characterId: string): Promise<void> => {
  // Tryb backendu: zamiast upsertu do Supabase wyślij autorytatywny commit stanu
  // do backendu (jedyny zapisujący). localStorage pozostaje buforem write-ahead.
  if (isBackendMode()) {
    await commitStateToBackend(characterId);
    return;
  }

  const raw = localStorage.getItem(localKey(characterId));
  if (!raw) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const parsed: ILocalSave = JSON.parse(raw);

    await supabase
      .from('game_saves')
      .upsert(
        {
          user_id: session.user.id,
          character_id: characterId,
          state: parsed.state,
          updated_at: parsed.updated_at ?? new Date().toISOString(),
        },
        { onConflict: 'character_id' },
      );
  } catch {
    // offline – will retry later
  }
};

// -- Delete ------------------------------------------------------------------

/**
 * Remove saved data for a deleted character (both local and cloud).
 */
export const deleteGameSave = async (characterId: string): Promise<void> => {
  localStorage.removeItem(localKey(characterId));

  // Tryb backendu: serwer kasuje game_saves w ramach transakcji usuwania postaci
  // (patrz characterApi.deleteCharacter). Klient TYLKO czyści lokalny cache i NIE
  // wysyła DELETE do Supabase — spójnie z saveGame/syncToCloud (serwer = jedyny
  // zapisujący do game_saves).
  if (isBackendMode()) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from('game_saves')
      .delete()
      .eq('character_id', characterId);
  } catch {
    // ignore
  }
};
