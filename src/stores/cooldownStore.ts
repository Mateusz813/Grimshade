import { create } from 'zustand';

/**
 * Persists potion + skill cooldowns across fights so a skill used at the end
 * of fight N is still on cooldown at the start of fight N+1. Cooldowns tick
 * down on real time (the Combat view advances them via the unified timer).
 */
interface ICooldownStore {
    hpPotionCooldown: number;
    mpPotionCooldown: number;
    pctHpCooldown: number;
    pctMpCooldown: number;
    /** skillId → ms remaining */
    skillCooldowns: Record<string, number>;

    setHpPotionCooldown: (ms: number) => void;
    setMpPotionCooldown: (ms: number) => void;
    setPctHpCooldown: (ms: number) => void;
    setPctMpCooldown: (ms: number) => void;
    setSkillCooldown: (skillId: string, ms: number) => void;
    /** Bulk-update skill cooldowns map (used by tick reducers). */
    setSkillCooldowns: (next: Record<string, number>) => void;
    /** Tick all cooldowns down by `decMs` (clamped at 0). */
    tick: (decMs: number) => void;
    clearAll: () => void;
}

export const useCooldownStore = create<ICooldownStore>((set) => ({
    hpPotionCooldown: 0,
    mpPotionCooldown: 0,
    pctHpCooldown: 0,
    pctMpCooldown: 0,
    skillCooldowns: {},

    setHpPotionCooldown: (ms) => set({ hpPotionCooldown: Math.max(0, ms) }),
    setMpPotionCooldown: (ms) => set({ mpPotionCooldown: Math.max(0, ms) }),
    setPctHpCooldown: (ms) => set({ pctHpCooldown: Math.max(0, ms) }),
    setPctMpCooldown: (ms) => set({ pctMpCooldown: Math.max(0, ms) }),
    setSkillCooldown: (skillId, ms) =>
        set((s) => ({ skillCooldowns: { ...s.skillCooldowns, [skillId]: Math.max(0, ms) } })),
    setSkillCooldowns: (next) => set({ skillCooldowns: next }),

    tick: (decMs) =>
        set((s) => {
            const nextSkills: Record<string, number> = {};
            for (const [k, v] of Object.entries(s.skillCooldowns)) {
                const nv = Math.max(0, v - decMs);
                if (nv > 0) nextSkills[k] = nv;
            }
            return {
                hpPotionCooldown: Math.max(0, s.hpPotionCooldown - decMs),
                mpPotionCooldown: Math.max(0, s.mpPotionCooldown - decMs),
                pctHpCooldown: Math.max(0, s.pctHpCooldown - decMs),
                pctMpCooldown: Math.max(0, s.pctMpCooldown - decMs),
                skillCooldowns: nextSkills,
            };
        }),

    clearAll: () =>
        set({
            hpPotionCooldown: 0,
            mpPotionCooldown: 0,
            pctHpCooldown: 0,
            pctMpCooldown: 0,
            skillCooldowns: {},
        }),
}));
