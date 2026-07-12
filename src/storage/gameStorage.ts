import { supabase } from '../lib/supabase';
import { isBackendMode } from '../config/backendMode';
import { commitStateToBackend } from '../api/backend/commit';


const localKey = (characterId: string): string =>
  `dungeon_rpg_save_char_${characterId}`;

interface ILocalSave {
  state: Record<string, unknown>;
  updated_at: string;
}


export const saveGame = async (
  characterId: string,
  state: Record<string, unknown>,
): Promise<void> => {
  const now = new Date().toISOString();
  const payload: ILocalSave = { state, updated_at: now };

  try {
    localStorage.setItem(localKey(characterId), JSON.stringify(payload));
  } catch {
  }

  if (isBackendMode()) {
    await commitStateToBackend(characterId);
    return;
  }

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
  }
};


export const loadGame = async (
  characterId: string,
): Promise<Record<string, unknown> | null> => {
  let cloudState: Record<string, unknown> | null = null;
  let cloudUpdated = 0;

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
  }

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
  }

  if (cloudState && cloudUpdated >= localUpdated) {
    try {
      localStorage.setItem(
        localKey(characterId),
        JSON.stringify({ state: cloudState, updated_at: new Date(cloudUpdated).toISOString() }),
      );
    } catch {
    }
    return cloudState;
  }

  if (localState) {
    return localState;
  }

  return cloudState;
};


export const syncToCloud = async (characterId: string): Promise<void> => {
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
  }
};


export const deleteGameSave = async (characterId: string): Promise<void> => {
  localStorage.removeItem(localKey(characterId));

  if (isBackendMode()) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await supabase
      .from('game_saves')
      .delete()
      .eq('character_id', characterId);
  } catch {
  }
};
