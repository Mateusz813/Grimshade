// -- URL-leave / tab-close death penalty ---------------------------------------
//
// Shared helper used by Dungeon, Boss, Raid and Transform views. When the
// player navigates away mid-combat (back button, direct URL change, page
// refresh, tab close) we treat it as a real death — full level/XP loss,
// skill XP loss, item loss — so the player can't escape consequences by
// editing the address bar.
//
// IMPORTANT: this bypasses the consumable-protection items (Eliksir Ochrony,
// Amulet of Loss) by design. Those potions exist to forgive *real* combat
// deaths; using them as a "panic button" while you flee through the URL bar
// would defeat the whole point of the guard. If a player wanted protection
// they should have stayed and clicked Ucieknij (which is the soft flee
// penalty, ~1/10 of the death cost).

import { useCharacterStore } from '../stores/characterStore';
import { useSkillStore } from '../stores/skillStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useDeathStore } from '../stores/deathStore';
import { useCombatStore } from '../stores/combatStore';
import { saveCurrentCharacterStoresSync } from '../stores/characterScope';
import { applyDeathPenalty } from './levelSystem';
import { deathsApi } from '../api/v1/deathsApi';
import { supabase } from '../lib/supabase';
import { isBackendMode } from '../config/backendMode';
import { commitStateViaKeepalive } from '../api/backend/commit';
import { backendApi } from '../api/backend/backendApi';

// 2026-05-20: added 'monster' to cover hunt-route disconnects fired from
// the AppShell DC watcher. The deaths API already accepts the value
// (`TDeathSource` includes 'monster'); this type just keeps the helper's
// surface in sync with what callers can legitimately pass.
export type TLeaveSource = 'monster' | 'dungeon' | 'boss' | 'raid' | 'transform';

// -- Supabase env (cached) -----------------------------------------------------
// Read once at module load so the keepalive PATCH below can fire synchronously
// during a `beforeunload` event without paying for any module/import work.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// -- Access-token cache --------------------------------------------------------
// `supabase.auth.getSession()` is async — useless inside a `beforeunload`
// handler where the page is already navigating. We mirror the access token
// to a module-level variable so the keepalive PATCH below can read it
// synchronously.
//
// The cache is filled the first time this module is imported (initial async
// fetch) and refreshed on every auth state change (sign-in / sign-out / token
// refresh). Worst-case for a brand-new session that hasn't completed its
// first `getSession()` yet: the keepalive PATCH skips, but the local store
// + localStorage are still updated synchronously — the next page load will
// re-sync from `_characterStats` (see `restoreFromLocalStorageSync`) so the
// player still loses what they should.
let cachedAccessToken: string | null = null;

void supabase.auth.getSession().then(({ data }) => {
    cachedAccessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
    cachedAccessToken = session?.access_token ?? null;
});

interface IApplyLeaveDeathArgs {
    /** Which combat view the player was in. Routed straight into the death-log
     *  table's `source` column so the deaths feed shows the right icon/filter. */
    source: TLeaveSource;
    /** Display name of the dungeon/boss/raid/transform — shown in the death
     *  overlay's "killed by" line. We append "(uciekłeś z gry)" so the player
     *  can clearly distinguish real deaths from leave-penalties in the feed. */
    sourceName: string;
    /** Numeric level of the source — same field as a normal death. */
    sourceLevel: number;
}

/**
 * Apply the full death penalty as if the player had been killed in combat.
 * Safe to call from a useEffect cleanup OR a `beforeunload` listener — every
 * step is synchronous except the DB log (fire-and-forget; the local state
 * update is what actually punishes the player).
 *
 * Idempotent guard is the caller's responsibility — this helper does NOT
 * track "already applied" state. Use a per-view `appliedRef` so unmount +
 * beforeunload don't both fire for the same leave event.
 */
export const applyCombatLeaveDeath = ({
    source,
    sourceName,
    sourceLevel,
}: IApplyLeaveDeathArgs): void => {
    const char = useCharacterStore.getState().character;
    if (!char) return;

    // 2026-05-19 v25 spec ("Tylko potwór przegnał i nick postaci"):
    // drop the "(uciekłeś z gry)" suffix that used to pollute the
    // source_name. The deaths feed now reads the `result` column to
    // pick the verb — `result: 'fled'` here renders as "przegnał"
    // automatically without polluting the monster name.
    const taggedName = sourceName;

    // Best-effort DB log. Fire BEFORE the level update so the recorded
    // `character_level` reflects what the player WAS when they bailed
    // (matches how real deaths log it pre-penalty).
    if (isBackendMode() && char) {
        void backendApi.logDeath(char.id, {
            source,
            source_name: taggedName,
            source_level: sourceLevel,
            result: 'fled',
        });
    } else {
        void deathsApi.logDeath({
            character_id: char.id,
            character_name: char.name,
            character_class: char.class,
            character_level: char.level,
            source,
            source_name: taggedName,
            source_level: sourceLevel,
            result: 'fled',
        });
    }

    // Apply level/XP penalty — bypasses Eliksir Ochrony (death protection)
    // and Amulet of Loss intentionally, see header comment.
    const penalty = applyDeathPenalty(char.level, char.xp);
    const oldLevel = char.level;
    const currentHighest = char.highest_level ?? char.level;
    const preservedHighest = Math.max(currentHighest, char.level);

    useCharacterStore.getState().updateCharacter({
        xp: penalty.newXp,
        level: penalty.newLevel,
        highest_level: preservedHighest,
    });
    useCharacterStore.getState().fullHealEffective();
    useSkillStore.getState().applyDeathPenalty(char.class, penalty.skillXpLossPercent);
    useSkillStore.getState().purgeLockedSkillSlots(char.class, penalty.newLevel);
    // Item loss only from level 51+ (lvl 1-50 beginner grace) — enforced inside.
    useInventoryStore.getState().applyDeathItemLoss(false, char.level);
    useCombatStore.getState().clearCombatSession();

    // Sync save BEFORE the death overlay triggers — overlay auto-navigates
    // and we want the disk state to already reflect the loss in case the
    // navigation happens to be a tab-close (where async saves get killed).
    saveCurrentCharacterStoresSync();

    // -- Persist the level/XP loss to Supabase (the canonical source) --------
    // CRITICAL anti-cheat step. The local store + localStorage updates above
    // are NOT enough — on next page load `App.tsx` calls
    // `characterApi.getCharacters()` which reads the canonical `characters`
    // row from Supabase. If the row still has the old level the player just
    // walks back into a clean character with no penalty applied (URL-leave
    // cheat would succeed).
    //
    // We can't `await` here — the typical caller is a `beforeunload` handler
    // where the page is already navigating away. Instead we fire a `fetch`
    // with `keepalive: true` which the browser is required to deliver even
    // after the page unloads. The token is pulled from a module-level cache
    // populated by `onAuthStateChange` (see top of file) so we don't have to
    // wait on `supabase.auth.getSession()`.
    if (isBackendMode()) {
        // Tryb backendu: NIE piszemy wprost do Supabase (to była dziura anti-cheat
        // — surowy PATCH characters level/xp z JWT gracza). Kara jest już w blobie
        // (_characterStats: obniżony level/xp), więc utrwalamy ją autorytatywnym
        // commitem stanu KEEPALIVE — przeżywa unload, serwer waliduje i zapisuje
        // (spadek poziomu przy karze śmierci jest dozwolony).
        commitStateViaKeepalive(char.id);
    } else if (SUPABASE_URL && SUPABASE_ANON && cachedAccessToken) {
        try {
            void fetch(`${SUPABASE_URL}/rest/v1/characters?id=eq.${char.id}`, {
                method: 'PATCH',
                keepalive: true,
                headers: {
                    apikey: SUPABASE_ANON,
                    Authorization: `Bearer ${cachedAccessToken}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                body: JSON.stringify({
                    level: penalty.newLevel,
                    xp: penalty.newXp,
                    highest_level: preservedHighest,
                    updated_at: new Date().toISOString(),
                }),
            }).catch(() => { /* fire-and-forget */ });
        } catch {
            // Some browsers throw synchronously if the keepalive payload
            // exceeds 64KB — our payload is ~120 bytes so this branch is
            // defensive only. Local store is already updated either way.
        }
    }

    // Trigger the global death overlay so the player sees a clear "you lost
    // X levels because you tried to cheat the URL" panel on their next
    // route. The overlay also handles auto-navigating to town.
    useDeathStore.getState().triggerDeath({
        killedBy: taggedName,
        sourceLevel,
        oldLevel,
        newLevel: penalty.newLevel,
        levelsLost: penalty.levelsLost,
        xpPercent: penalty.xpPercent,
        skillXpLossPercent: penalty.skillXpLossPercent,
        protectionUsed: false,
        source,
    });
};
