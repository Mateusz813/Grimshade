
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

export type TLeaveSource = 'monster' | 'dungeon' | 'boss' | 'raid' | 'transform';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let cachedAccessToken: string | null = null;

void supabase.auth.getSession().then(({ data }) => {
    cachedAccessToken = data.session?.access_token ?? null;
});
supabase.auth.onAuthStateChange((_event, session) => {
    cachedAccessToken = session?.access_token ?? null;
});

interface IApplyLeaveDeathArgs {
    source: TLeaveSource;
    sourceName: string;
    sourceLevel: number;
}

export const applyCombatLeaveDeath = ({
    source,
    sourceName,
    sourceLevel,
}: IApplyLeaveDeathArgs): void => {
    const char = useCharacterStore.getState().character;
    if (!char) return;

    const taggedName = sourceName;

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
    useInventoryStore.getState().applyDeathItemLoss(false, char.level);
    useCombatStore.getState().clearCombatSession();

    saveCurrentCharacterStoresSync();

    if (isBackendMode()) {
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
            }).catch(() => { });
        } catch {
        }
    }

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
