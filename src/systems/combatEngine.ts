/**
 * Combat Engine – pure logic functions for background combat.
 * All combat logic previously embedded in Combat.tsx component is now here.
 * These functions read/write directly to Zustand stores (no React dependencies).
 */
import {
    calculateDamage,
    calculateDualWieldDamage,
    calculateBlockChance,
    calculateDodgeChance,
    rollMonsterDamage,
} from './combat';
import { applyDeathPenalty } from './levelSystem';
import { consumeDeathProtection } from './deathProtection';
import { applySkillBuff, getSkillDef } from './skillBuffs';
import {
    calculateGoldDrop,
    rollLoot,
    rollMonsterRarity,
    rollStoneDrop,
    rollPotionDrop,
    rollSpellChestDrop,
    getSpellChestIcon,
    getSpellChestDisplayName,
    getGeneratedSellPrice,
    MONSTER_RARITY_MULTIPLIERS,
    MONSTER_RARITY_LABELS,
    MONSTER_RARITY_TASK_KILLS,
    type TMonsterRarity,
} from './lootSystem';
import { getClassSkillBonus, formatItemName, getTotalEquipmentStats, getEquippedGearLevel, getGearGapMultiplier, flattenItemsData, STONE_ICONS, type IBaseItem } from './itemSystem';
import { getTrainingBonuses, getCombatSkillUpgradeMultiplier } from './skillSystem';
import {
    getAtkDamageMultiplier,
    getSpellDamageMultiplier,
    getElixirHpBonus,
    getElixirMpBonus,
    getElixirAtkBonus,
    getElixirDefBonus,
    getElixirAttackSpeedMultiplier,
    getElixirHpPctMultiplier,
    getElixirMpPctMultiplier,
    tickCombatElixirs,
} from './combatElixirs';
import {
    getTransformDmgMultiplier,
    getTransformFlatHp,
    getTransformFlatMp,
    getTransformFlatAttack,
    getTransformFlatDefense,
    getTransformHpRegenFlat,
    getTransformMpRegenFlat,
    getTransformHpPctMultiplier,
    getTransformMpPctMultiplier,
    getTransformDefPctMultiplier,
    getTransformAtkPctMultiplier,
} from './transformBonuses';
import { generateRandomItem, getItemDisplayInfo } from './itemGenerator';
import { getMonsterUnlockStatus } from './progression';
import {
    getPotionCooldownMs,
    resolveAutoPotionElixir,
} from './potionSystem';
import itemsData from '../data/items.json';
import monstersRaw from '../data/monsters.json';
import classesRaw from '../data/classes.json';
import { useCombatStore, type IMonster } from '../stores/combatStore';
import { useCharacterStore } from '../stores/characterStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useSkillStore } from '../stores/skillStore';
import { useSettingsStore, type CombatSpeed } from '../stores/settingsStore';
import { useTaskStore } from '../stores/taskStore';
import { useQuestStore } from '../stores/questStore';
import { useDailyQuestStore } from '../stores/dailyQuestStore';
import { ELIXIRS } from '../stores/shopStore';
import { saveCurrentCharacterStores, saveCurrentCharacterStoresForce } from '../stores/characterScope';
import { deathsApi } from '../api/v1/deathsApi';
import { isBackendMode } from '../config/backendMode';
import { backendApi } from '../api/backend/backendApi';
import { useBuffStore } from '../stores/buffStore';
import { useMasteryStore, getMasteryXpMultiplier, getMasteryGoldMultiplier } from '../stores/masteryStore';
import { useCooldownStore } from '../stores/cooldownStore';
import { useDeathStore } from '../stores/deathStore';
import { useOfflineHuntStore } from '../stores/offlineHuntStore';
import { useBotStore } from '../stores/botStore';
import { usePartyStore } from '../stores/partyStore';
import {
    pickWeightedAggroTarget,
    calculateXpMultiplier,
    calculateDropMultiplier,
} from './partySystem';
import type { TCharacterClass } from '../types/character';
import type { CharacterClass } from '../api/v1/characterApi';
import {
    newCombatEffectsSession,
    ensureStatus,
    isCombatantStunned,
    castSkill as effectsCastSkill,
    tickAll as effectsTickAll,
    routeDamage as effectsRouteDamage,
    type ICombatEffectsSession,
} from './combatEffectsHelpers';
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy, applyManaShieldRedirect } from './skillEffectsV2';

/**
 * Mirror the `consumed` flags returned by `consumeCasterBasicHitMods`
 * into BuffStore — drains the visible "×N" charge counter on the
 * BuffBar so the player sees their Strzał Boga / Klon Cienia stack
 * tick down per basic swing. Called from EVERY engine basic-attack
 * path (Hunt / Boss / Dungeon / Transform / Trainer).
 */
export const syncCasterChargeConsume = (
    consumed: {
        dmgAmpNext: boolean;
        critNext: boolean;
        critBuffNext: boolean;
        lifestealNext?: boolean;
        nextAllyHeal?: boolean;
    },
): void => {
    const bs = useBuffStore.getState();
    if (consumed.dmgAmpNext)    bs.consumeBuffCharge('skill_charge_dmg_amp_next');
    if (consumed.critNext)      bs.consumeBuffCharge('skill_charge_crit_next');
    if (consumed.critBuffNext)  bs.consumeBuffCharge('skill_charge_crit_buff_next');
    if (consumed.lifestealNext) bs.consumeBuffCharge('skill_charge_party_lifesteal_next');
    if (consumed.nextAllyHeal)  bs.consumeBuffCharge('skill_charge_next_ally_heal');
};
import { useNecroSummonStore } from '../stores/necroSummonStore';

// -- Constants ----------------------------------------------------------------

/**
 * 2026-05-12 spec ("niech zabiera MP zgodnie z opisem"): each skill has
 * its OWN MP cost baked into `data/skills.json` (e.g. god_arrow=220,
 * destiny_shot=280, universe_arrow=400). Engine + UI read it via
 * `getSkillDef(skillId).mpCost`. Falls back to a small flat floor when
 * the skill is missing the field (legacy slots, defensive default).
 */
const SKILL_MP_COST_FLOOR = 15;
export const getSkillMpCost = (skillId?: string | null): number => {
    if (!skillId) return SKILL_MP_COST_FLOOR;
    try {
        const def = getSkillDef(skillId);
        const c = def?.mpCost;
        if (typeof c === 'number' && c > 0) return c;
        return SKILL_MP_COST_FLOOR;
    } catch {
        return SKILL_MP_COST_FLOOR;
    }
};
const SKILL_COOLDOWN_MS = 8000;

// Hunt-engine module-level effect session. Single source of truth for stun /
// DOT / immortal / mark / dodge state across the engine's tick callbacks
// (doPlayerAttackTick / doMonsterAttackTick / doBotAttackTick) and the
// view-side manual skill cast (Combat.tsx -> doUseSkill). Reset by
// `startNewFight` so each fresh fight starts clean.
let huntEffects: ICombatEffectsSession = newCombatEffectsSession();
const HUNT_PLAYER_FX_ID = 'player';
const huntMonsterFxId = (slot: number, id: string): string => `m_${slot}_${id}`;
const lastDotTickAtRef = { value: Date.now() };

/** Reset the hunt effect session — called at fight start. */
export const resetHuntEffects = (): void => {
    huntEffects = newCombatEffectsSession();
    lastDotTickAtRef.value = Date.now();
};

/**
 * Consume one mark_amp charge on the wave monster at `slot` and return
 * the amp multiplier to apply to THIS hit. Surface for Combat.tsx's
 * view-layer manual cast path so spell damage gets the same Klątwa
 * Śmierci ×6 boost the engine auto-cast / basic attacks already get.
 */
export const consumeHuntMonsterMarkAmp = (slot: number, monsterId: string): {
    mult: number;
    consumed: boolean;
} => {
    const st = huntEffects.statuses.get(huntMonsterFxId(slot, monsterId));
    return consumeTargetMarkAmp(st);
};

/** Drop every necromancer summon for the local hunt player. Called on death
 *  / zone-change so spent fights don't leak undead carry-over. */
export const clearHuntNecroSummons = (): void => {
    useNecroSummonStore.getState().clear(HUNT_PLAYER_FX_ID);
};

/** True if the player is currently stunned/paralysed in the hunt engine. */
export const isHuntPlayerStunned = (): boolean =>
    isCombatantStunned(huntEffects, HUNT_PLAYER_FX_ID);

/** True if the given monster slot+id is stunned/paralysed. */
export const isHuntMonsterStunned = (slot: number, id: string): boolean =>
    isCombatantStunned(huntEffects, huntMonsterFxId(slot, id));

/**
 * Live status view for the per-slot wave monster — used by the Combat
 * view to render the stun / immortal countdown badge on the EnemyCard.
 * Returns 0s when the monster has no entry yet (e.g. immediately after
 * a wave swap, before any cast). Read every render — the engine mutates
 * the status object in-place via `tickStatus` so a render alone is
 * enough to see the latest values.
 */
export const getHuntMonsterStatusView = (slot: number, id: string): {
    stunMs: number;
    immortalMs: number;
    markHealToDmgMs: number;
    markAmpMs: number;
    markAmpMult: number;
    darkRitualMs: number;
    darkRitualPct: number;
    markAmpAllMs: number;
    markAmpAllMult: number;
} => {
    const st = huntEffects.statuses.get(huntMonsterFxId(slot, id));
    if (!st) return { stunMs: 0, immortalMs: 0, markHealToDmgMs: 0, markAmpMs: 0, markAmpMult: 0, darkRitualMs: 0, darkRitualPct: 0, markAmpAllMs: 0, markAmpAllMult: 0 };
    const top = st.markAmp.find((m) => m.count > 0 && m.remainingMs > 0);
    // Mroczny Rytuał — soonest-firing entry on this monster.
    const topRitual = st.darkRitualPending.length > 0
        ? st.darkRitualPending.reduce((a, b) => (a.triggerInMs <= b.triggerInMs ? a : b))
        : null;
    return {
        stunMs: st.stunMs,
        immortalMs: st.immortalMs,
        markHealToDmgMs: st.markNoHealMs,
        markAmpMs: top?.remainingMs ?? 0,
        markAmpMult: top?.mult ?? 0,
        darkRitualMs: topRitual?.triggerInMs ?? 0,
        darkRitualPct: topRitual?.pctOfMaxHp ?? 0,
        markAmpAllMs: st.markAmpAll?.remainingMs ?? 0,
        markAmpAllMult: st.markAmpAll?.mult ?? 0,
    };
};

/** Drains DOT/timer state across the active player + every alive wave
 *  monster. Should be called periodically by `useBackgroundCombat`. */
export const huntStatusTick = (): void => {
    const s = useCombatStore.getState();
    const ch = useCharacterStore.getState().character;
    if (!ch || s.phase !== 'fighting') return;
    const eff = getEffectiveChar(ch);
    // 2026-05 v6: BUG FIX — IWaveMonster has neither `slotIndex` nor `id`
    // properties (those got renamed long ago to `monster.id`). The old
    // mapping produced `huntMonsterFxId(undefined, undefined)` for EVERY
    // monster, so the DOT id we registered when casting (which uses
    // `huntMonsterFxId(activeIdx, wm.monster.id)`) never matched the id
    // we ticked here — meaning Zatruty Strzał / Plaga / Mistrzostwo Miecza
    // queued a DOT but no monster ever lost HP from it. Now we use the
    // array index for the slot and `monster.id` for the monster, matching
    // exactly what `huntApplySkillEffectV2` writes.
    const refs = [
        { id: HUNT_PLAYER_FX_ID, maxHp: eff?.max_hp ?? ch.max_hp },
        ...s.waveMonsters
            .map((wm, idx) => ({ wm, idx }))
            .filter(({ wm }) => !wm.isDead)
            .map(({ wm, idx }) => ({ id: huntMonsterFxId(idx, wm.monster.id), maxHp: wm.maxHp })),
    ];
    const now = Date.now();
    // Wall-clock elapsed since the previous tick — clamped so a slow tab
    // wake-up doesn't wipe the DOT in a single frame.
    const wallDelta = Math.min(1000, Math.max(50, now - lastDotTickAtRef.value));
    lastDotTickAtRef.value = now;
    // 2026-05 v6: scale game-time by combat speed. At x4 a 250ms wall tick
    // processes 1000ms of in-game time — DOTs / stuns / immortal windows
    // burn 4× faster so a 5s DOT drains in 1.25 wall seconds, matching the
    // rest of the speed-up. Without this the DOT crawled at the same real
    // rate regardless of the speed chip.
    const speedMult = SPEED_MULT[useSettingsStore.getState().combatSpeed] ?? 1;
    const delta = wallDelta * speedMult;
    // Game-time buffs are drained globally by BuffBar's 250ms tick which
    // reads combatSpeedMult from BuffStore (set by combat-view speed-change
    // handlers). Doing it here would double-count.
    const dots = effectsTickAll(huntEffects, refs, delta);
    for (const r of dots) {
        if (r.dotDamage <= 0 && !r.darkRitualTriggered) continue;
        if (r.id === HUNT_PLAYER_FX_ID) {
            if (r.dotDamage > 0) {
                const apply = effectsRouteDamage(huntEffects, HUNT_PLAYER_FX_ID, s.playerCurrentHp, r.dotDamage);
                if (apply.appliedDmg > 0) useCombatStore.getState().dealToPlayer(apply.appliedDmg);
            }
            // (Player can't be ritual'd — no-op for darkRitualTriggered here.)
        } else {
            // Find the wave slot whose `monster.id`+slotIndex match the fx id.
            const live = useCombatStore.getState().waveMonsters;
            for (let slotIdx = 0; slotIdx < live.length; slotIdx++) {
                const wm = live[slotIdx];
                if (wm.isDead) continue;
                if (huntMonsterFxId(slotIdx, wm.monster.id) !== r.id) continue;
                if (r.dotDamage > 0) {
                    const apply = effectsRouteDamage(huntEffects, r.id, wm.currentHp, r.dotDamage);
                    if (apply.appliedDmg > 0) {
                        useCombatStore.getState().damageWaveMonster(slotIdx, apply.appliedDmg);
                        // 2026-05 v6: emit per-tick dot visual so the view can
                        // pop a green poison-tinted number on the affected
                        // monster card. Without this the DOT silently drains
                        // HP and the player can't tell the spell is working.
                        useCombatStore.getState().emitCombatEvent({
                            type: 'dotTick',
                            data: { targetIdx: slotIdx, damage: apply.appliedDmg },
                            timestamp: Date.now(),
                        });
                    }
                }
                // 2026-05 v7: Mroczny Rytuał detonation. Strip % of max HP
                // straight from currentHp (true HP-percent, no DEF mit).
                if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    const ritualDmg = Math.min(useCombatStore.getState().waveMonsters[slotIdx]?.currentHp ?? 0, r.darkRitualDamage);
                    if (ritualDmg > 0) {
                        useCombatStore.getState().damageWaveMonster(slotIdx, ritualDmg);
                        useCombatStore.getState().emitCombatEvent({
                            type: 'darkRitualTick',
                            data: { targetIdx: slotIdx, damage: ritualDmg },
                            timestamp: Date.now(),
                        });
                    }
                }
                // 2026-05 v7 BUG FIX: tick-loop kills (DOT or Mroczny
                // Rytuał) need to fire the death + reward flow exactly
                // like a basic-attack killing-blow. Without this the
                // wave monster's HP bar drained to 0 but the fight
                // stayed in the `fighting` phase — UI froze, no loot,
                // no XP, no advance to the next wave target. Reproduced
                // when a Necro summon swung the killing blow at the
                // same tick the ritual fired (boss view), and equally
                // possible in Hunt when a DOT/ritual finishes off the
                // active wave monster.
                const afterTick = useCombatStore.getState();
                const slotAfter = afterTick.waveMonsters[slotIdx];
                if (slotAfter && slotAfter.currentHp <= 0 && !slotAfter.isDead && afterTick.phase === 'fighting') {
                    if (slotIdx === afterTick.activeTargetIdx) {
                        // Active target — full reward / advance flow.
                        handleMonsterDeath(afterTick.monsterRarity);
                    } else {
                        // Non-active wave monster (rare: only if a
                        // multi-target DOT spread the kill). Mark dead
                        // silently so the bar reflects death; rewards
                        // arrive when the active monster dies.
                        useCombatStore.setState((s) => ({
                            waveMonsters: s.waveMonsters.map((w, i) =>
                                i === slotIdx ? { ...w, isDead: true, currentHp: 0 } : w,
                            ),
                        }));
                    }
                }
                break;
            }
        }
    }
};

// Update the engine's `huntApplySkillEffect` to use the array index as the slot.
export const huntApplySkillEffectV2 = (
    skillId: string,
    activeIdx: number,
) => {
    const s = useCombatStore.getState();
    const ch = useCharacterStore.getState().character;
    if (!ch) return null;
    // 2026-05-10 spec ("knight niby niezyje a spelle uzywa"): if the
    // caster's character HP is 0 (or playerCurrentHp is 0 in active
    // combat), a stale UI shouldn't be allowed to fire spells. Block
    // the cast entirely so dead casters can't damage monsters or
    // broadcast spell-cast cues.
    if ((ch.hp ?? 0) <= 0 || s.playerCurrentHp <= 0) return null;
    // 2026-05-11 spec ("podstawowy atak zabija potwora i spell dalej
    // atakuje w tego potwora — to nie moze sie dziac"): if the slot
    // we were going to hit is already dead (basic attack or ally
    // killed it between cast start and apply), retarget to the next
    // alive wave monster. If NO monster is alive, refuse the cast —
    // member's MP / cooldown isn't burned and the leader doesn't
    // process a no-op.
    let wm = s.waveMonsters[activeIdx];
    if (!wm || wm.isDead || wm.currentHp <= 0) {
        const aliveIdx = s.waveMonsters.findIndex((w) => !w.isDead && w.currentHp > 0);
        if (aliveIdx < 0) return null;
        activeIdx = aliveIdx;
        wm = s.waveMonsters[aliveIdx];
        // Sync the engine's `activeTargetIdx` AND the mirrored
        // `monster` / `monsterCurrentHp` / `monsterMaxHp` /
        // `monsterRarity` fields so downstream callers (the click
        // handler in Combat.tsx, the auto-cast loop below) see a
        // coherent snapshot when they re-read after this fn returns.
        useCombatStore.setState({
            activeTargetIdx: aliveIdx,
            monster: wm.monster,
            monsterCurrentHp: wm.currentHp,
            monsterMaxHp: wm.maxHp,
            monsterRarity: wm.rarity,
        });
    }
    if (!wm) return null;
    const def = getSkillDef(skillId);
    // 2026-05-09 spec ("walka zsynchronizowana"): every spell cast that
    // resolves locally — manual or auto, leader or member — is broadcast
    // to the party-combat channel so the OTHER clients can play the
    // matching ally-card / enemy-card animation. If a player toggles
    // auto-spells OFF locally, their engine never reaches this path ->
    // no broadcast -> teammates see nothing.
    {
        const partyState = usePartyStore.getState().party;
        if (partyState && ch?.id) {
            const otherHumans = partyState.members.filter((m) => m.id !== ch.id && !m.isBot);
            if (otherHumans.length > 0) {
                // 2026-05-09 spec ("animacja na potworze, nie na casterze"):
                // ship the target slot + isDamageHit so the receiver can
                // play the spell anim on the MONSTER card (not the caster's
                // ally card) and floating damage lands on the right slot.
                // Damage value isn't known yet at this point — the caller's
                // post-resolution `monsterHit` event already carries it,
                // so the receiver renders the float from there.
                // ISkillDef.damage isn't in the interface at type-level
                // (runtime field only — see existing pre-existing usages
                // in this file). Cast through unknown to read it safely.
                const isDamageHitLocal = ((def as unknown as { damage?: number })?.damage ?? 0) > 0;
                import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishSpellCast({
                        casterId:    ch.id,
                        casterName:  ch.name,
                        skillId,
                        label:       def?.name_pl ?? def?.name_en ?? skillId,
                        targetIdx:   activeIdx,
                        isDamageHit: isDamageHitLocal,
                    });
                }).catch(() => { /* offline — fine */ });
            }
        }
    }
    // 2026-05 v7: Apokalipsa Śmierci — synchronous self-cost BEFORE
    // the cast resolves. Spec: > 20% -> 20%, 5–20% -> 3%, < 5% -> blocked.
    if ((def?.effect ?? '').includes('death_apocalypse') && ch.class === 'Necromancer') {
        const playerCurHp = useCombatStore.getState().playerCurrentHp;
        // Use EFFECTIVE max HP (base + equipment + training + elixirs +
        // transform), same scale as the TopHeader bar. Pre-fix used
        // ch.max_hp (base) which made the displayed drop ~18% instead
        // of the spec'd 20%.
        const effChar = getEffectiveChar(ch);
        const playerMaxHp = effChar?.max_hp ?? ch.max_hp;
        const hpPct = playerCurHp / Math.max(1, playerMaxHp);
        if (hpPct < 0.05) {
            useCombatStore.getState().addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP', 'system');
            return null;
        }
        let newPlayerHp: number;
        if (hpPct > 0.20) {
            newPlayerHp = Math.max(1, playerCurHp - Math.floor(playerMaxHp * 0.20));
        } else {
            newPlayerHp = Math.max(1, Math.floor(playerMaxHp * 0.03));
        }
        const lost = playerCurHp - newPlayerHp;
        if (lost > 0) {
            useCombatStore.getState().dealToPlayer(lost);
            useCharacterStore.getState().updateCharacter({
                hp: useCombatStore.getState().playerCurrentHp,
            });
            useCombatStore.getState().addLog(
                `:broken-heart: Apokalipsa: -${lost} HP (kanał życia)`,
                'system',
            );
        }
    }
    // 2026-05 v6: include alive party bots in allyIds so party_attack_up /
    // party_defense_up / party_as_up etc. actually write to their status.
    // Without this, Knight Okrzyk Bojowy / Umocnienie buffed only the
    // caster, never any party member.
    const aliveBotIds = useBotStore.getState().bots.filter((b) => b.alive).map((b) => b.id);
    const apply = effectsCastSkill({
        session: huntEffects,
        casterId: HUNT_PLAYER_FX_ID,
        targetId: huntMonsterFxId(activeIdx, wm.monster.id),
        targetHpPct: wm.maxHp > 0 ? (wm.currentHp / wm.maxHp) * 100 : 100,
        effect: def?.effect ?? null,
        allyIds: [HUNT_PLAYER_FX_ID, ...aliveBotIds],
        enemyIds: s.waveMonsters
            .map((m, i) => ({ m, i }))
            .filter(({ m }) => !m.isDead)
            .map(({ m, i }) => huntMonsterFxId(i, m.monster.id)),
    });
    // Necromancer summon spawn — only when caster is a necro. Summons stack
    // on the necro's avatar (badge in AllyCard); shield mechanics live in the
    // monster-attack path above. Per-type caps + HP fractions live in
    // `useNecroSummonStore`.
    if (apply?.summons && apply.summons.length > 0 && ch.class === 'Necromancer') {
        const store = useNecroSummonStore.getState();
        for (const sm of apply.summons) {
            const spawned = store.spawn(HUNT_PLAYER_FX_ID, sm.type, sm.count, ch.attack, ch.max_hp);
            if (spawned > 0) {
                // 2026-05 v7: emit a summonSpawn event so the view can
                // play the per-type 2s avatar overlay animation.
                useCombatStore.getState().emitCombatEvent({
                    type: 'summonSpawn',
                    data: { summonType: sm.type, count: spawned },
                    timestamp: Date.now(),
                });
            }
        }
    }
    // 2026-05 v7: Apokalipsa Śmierci — target damage only (self-cost
    // already applied at the top of huntApplySkillEffectV2 above).
    if (apply?.deathApocalypse && ch.class === 'Necromancer') {
        const apocDmg = Math.max(1, Math.floor(wm.maxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
        useCombatStore.getState().damageWaveMonster(activeIdx, apocDmg);
        useCombatStore.getState().addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`, 'system');
        useCombatStore.getState().emitCombatEvent({
            type: 'monsterHit',
            data: { damage: apocDmg, isCrit: true, isBlocked: false, hand: null, targetIdx: activeIdx },
            timestamp: Date.now(),
        });
        const afterApoc = useCombatStore.getState();
        if (afterApoc.monsterCurrentHp <= 0 && afterApoc.phase === 'fighting') {
            handleMonsterDeath(afterApoc.monsterRarity);
        }
    }
    return apply;
};

export const SPEED_MULT: Record<string, number> = { x1: 1, x2: 2, x4: 4 };
export const SPEED_ORDER: CombatSpeed[] = ['x1', 'x2', 'x4', 'SKIP'];

const CLASS_MODIFIER: Record<string, number> = {
    Knight: 1.0, Mage: 1.3, Cleric: 1.0,
    Archer: 1.2, Rogue: 1.0, Necromancer: 1.2, Bard: 1.0,
};

interface IClassData {
    dualWield?: boolean;
    dualWieldDmgPercent?: number;
    canBlock?: boolean;
    canDodge?: boolean;
    maxCritChance?: number;
    mlvlFromAttacks?: boolean;
}

const classesArray = classesRaw as unknown as (IClassData & { id: string })[];
const classesData: Record<string, IClassData> = {};
for (const c of classesArray) {
    classesData[c.id] = c;
}

const ALL_ITEMS: IBaseItem[] = flattenItemsData(itemsData as Parameters<typeof flattenItemsData>[0]);
const monsters = monstersRaw as unknown as IMonster[];

const STONE_TYPE_TO_RARITY: Record<string, 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic'> = {
    common_stone: 'common', rare_stone: 'rare', epic_stone: 'epic',
    legendary_stone: 'legendary', mythic_stone: 'mythic', heroic_stone: 'heroic',
};

const STONE_NAMES_MAP: Record<string, string> = {
    normal: 'Common Stone', strong: 'Rare Stone', epic: 'Epic Stone',
    legendary: 'Legendary Stone', boss: 'Mythic Stone',
    common_stone: 'Common Stone', rare_stone: 'Rare Stone', epic_stone: 'Epic Stone',
    legendary_stone: 'Legendary Stone', mythic_stone: 'Mythic Stone', heroic_stone: 'Heroic Stone',
};

const stoneTypeToRarity = (stoneType: string): 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'heroic' =>
    STONE_TYPE_TO_RARITY[stoneType] ?? 'common';

// -- Skill cooldown tracking -------------------------------------------------
// Module-level so it persists across all tick calls.
const skillCooldownMap = new Map<string, number>();

/**
 * Advance skill cooldowns by `ms` milliseconds.
 * Used by batch processing in useBackgroundCombat to simulate time passing
 * between catch-up attack iterations (browser tab throttling).
 */
export const advanceSkillCooldowns = (ms: number): void => {
    for (const [skillId, lastUsed] of skillCooldownMap.entries()) {
        skillCooldownMap.set(skillId, lastUsed - ms);
    }
};

// -- Bot party helpers -------------------------------------------------------
// Bot companions from partyStore are lightweight IPartyMember objects.
// For regular combat we need full IBot with attack/defense/etc. This helper
// hydrates botStore from partyStore's bot members — runs at `startNewFight`.

/**
 * Hydrate `botStore.bots` with full IBot objects generated from the party's
 * bot members. Only runs if:
 *   - Player has an active party
 *   - Party contains at least one `isBot === true` member
 *   - `botStore.bots` is empty (don't clobber an existing combat party)
 */
export const hydrateBotsFromParty = (): void => {
    const party = usePartyStore.getState().party;
    if (!party) return;
    const botMembers = party.members.filter((m) => m.isBot);
    if (botMembers.length === 0) return;
    if (useBotStore.getState().bots.length > 0) return;

    const char = useCharacterStore.getState().character;
    if (!char) return;

    const botClasses = botMembers.map((m) => m.class as TCharacterClass);
    useBotStore.getState().generateBotsCustom(char.level, botClasses);

    useCombatStore.getState().addLog(
        `:handshake: Twoja drużyna (${botMembers.length} bot${botMembers.length === 1 ? '' : 'y'}) dołącza do walki!`,
        'system',
    );
};

// -- Aggro target tracking ---------------------------------------------------
// In multi-entity combat (player + bots), the monster rolls a class-weighted
// target and sticks with it for AGGRO_SWITCH_INTERVAL_MS before re-rolling.
// Knights eat most of the aggro, Cleric/Bard are backline.

const AGGRO_SWITCH_INTERVAL_MS = 10_000;
let aggroTargetId: string | null = null;
let aggroLastSwitchAt = 0;

/** Reset aggro state — called on new fight / stop / death. */
export const resetAggro = (): void => {
    aggroTargetId = null;
    aggroLastSwitchAt = 0;
    waveAggroState.clear();
};

// -- Per-wave-monster aggro tracking (parallel attacks) ---------------------
// Each wave monster has its own independent aggro target which re-rolls at
// an AGGRO_SWITCH_INTERVAL_MS interval. Keyed by monster wave index.
interface IWaveAggroEntry {
    targetId: string;
    lastSwitchAt: number;
}
const waveAggroState = new Map<number, IWaveAggroEntry>();

/** Ensure the given wave monster's aggro target is fresh; returns its current target id. */
const maybeSwitchWaveAggro = (waveIdx: number): string => {
    const now = Date.now();
    const entry = waveAggroState.get(waveIdx);
    // Aggro target is "alive" if it's the local player, an alive bot,
    // or a known party human (we assume members are alive — the leader
    // doesn't track each member's HP authoritatively yet, but the
    // member's character.hp is tracked locally on their client).
    const partyState = usePartyStore.getState().party;
    const knownHumanIds = new Set(
        (partyState?.members ?? [])
            .filter((m) => !m.isBot)
            .map((m) => `human_${m.id}`),
    );
    const alive = entry && (
        entry.targetId === 'player'
        || useBotStore.getState().bots.some((b) => b.id === entry.targetId && b.alive)
        || knownHumanIds.has(entry.targetId)
    );
    const needsRoll = !entry
        || !alive
        || now - entry.lastSwitchAt >= AGGRO_SWITCH_INTERVAL_MS;
    if (needsRoll) {
        const targetId = rollAggroTarget();
        waveAggroState.set(waveIdx, { targetId, lastSwitchAt: now });
        return targetId;
    }
    return entry.targetId;
};

/** Re-roll the monster's aggro target using class weights.
 *  Returns one of:
 *    - 'player'           — the local player (leader when in a party)
 *    - `bot_<id>`         — a bot id (from useBotStore)
 *    - `human_<id>`       — a remote party human (only included when
 *                            we ARE the leader of a multi-human party,
 *                            since the leader is the authoritative
 *                            aggro picker for everyone)
 */
const rollAggroTarget = (): string => {
    const char = useCharacterStore.getState().character;
    if (!char) return 'player';
    const aliveBots = useBotStore.getState().bots.filter((b) => b.alive);
    // 2026-05-11 spec ("agroo na sojusznikach"): when WE are the
    // party leader, include every human party member in the aggro
    // pool. Each remote member's id is encoded as `human_<id>` so
    // the engine + UI can tell them apart from bots/player.
    const partyState = usePartyStore.getState().party;
    const remoteHumans: Array<{ id: string; class: CharacterClass }> = [];
    if (partyState && partyState.leaderId === char.id) {
        for (const m of partyState.members) {
            if (m.isBot) continue;
            if (m.id === char.id) continue;
            remoteHumans.push({
                id: `human_${m.id}`,
                class: m.class as CharacterClass,
            });
        }
    }
    const candidates: Array<{ id: string; class: CharacterClass }> = [
        { id: 'player', class: char.class as CharacterClass },
        ...aliveBots.map((b) => ({ id: b.id, class: b.class as CharacterClass })),
        ...remoteHumans,
    ];
    return pickWeightedAggroTarget(candidates) ?? 'player';
};

/**
 * Ensure the aggro target is fresh. Re-rolls if:
 *   - No target set yet
 *   - Switch interval elapsed
 *   - Current target is a dead bot
 * Returns the current valid target id.
 */
export const maybeSwitchAggro = (): string => {
    const now = Date.now();
    const needsRoll = aggroTargetId === null
        || now - aggroLastSwitchAt >= AGGRO_SWITCH_INTERVAL_MS
        || (aggroTargetId !== 'player'
            && !useBotStore.getState().bots.some((b) => b.id === aggroTargetId && b.alive));
    if (needsRoll) {
        aggroTargetId = rollAggroTarget();
        aggroLastSwitchAt = now;
    }
    return aggroTargetId ?? 'player';
};

// -- Types --------------------------------------------------------------------

export interface IDropDisplay {
    icon: string;
    name: string;
    rarity: string;
    upgradeLevel?: number;
    sold?: boolean;
    soldPrice?: number;
}

export interface ICombatEvent {
    type: 'playerHit' | 'monsterHit' | 'playerDodge' | 'monsterDeath' | 'playerDeath' |
          'botHit' | 'botMonsterHit' |
          'floatingDmg' | 'skillAnim' | 'autoPotion' | 'victory' | 'levelUp' |
          // 2026-05 v6: per-tick DOT visual — engine emits this when a
          // status-effect tick (Zatruty Strzał / Plaga / Mistrzostwo
          // Miecza / Krwotok …) drains HP from a monster slot, so the
          // view can render a recurring poison-tinted floating number.
          'dotTick' |
          // 2026-05 v7: Necromancer Mroczny Rytuał detonation — fires
          // when the per-target countdown hits 0 and the monster loses
          // pct% of max HP. View renders :skull: RITUAL crit-styled float.
          'darkRitualTick' |
          // 2026-05 v7: Necromancer raised a new summon — view plays
          // the per-type 2s avatar overlay animation. data.summonType
          // is the type that just spawned (skeleton/ghost/demon/lich).
          'summonSpawn';
    data?: Record<string, unknown>;
    timestamp: number;
}

// -- Pure helpers -------------------------------------------------------------

/**
 * Maps game attackSpeed (1.5-4.0 typical) to an interval in ms.
 * speed 1.5 -> 2000ms · speed 2.0 -> 1500ms · speed 3.0 -> 1000ms · min 500ms.
 */
export const getAttackMs = (speed: number): number =>
    Math.max(500, Math.floor(3000 / Math.max(1, speed || 1)));

const getClassConfig = (className: string): IClassData => classesData[className] ?? {};

const rollWeaponDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

const rollOffHandDamage = (): number => {
    const { equipment } = useInventoryStore.getState();
    const weapon = equipment.offHand ?? equipment.mainHand;
    if (!weapon) return 0;
    const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
    const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
    if (dmgMax <= 0) return 0;
    return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
};

/**
 * @param contentLevel  Level of the content being fought (the monster's level).
 *   When > 0 and the player is under-geared for it, a gear-gap penalty scales
 *   down the effective attack (dmg × (gearLvl/contentLvl)², floor 0.05) so
 *   low-level gear can't practically clear far-higher-level monsters. 0 (the
 *   default) = no penalty — used by every HP/MP-clamp / sync / Raid caller.
 */
export const getEffectiveChar = (
    char: ReturnType<typeof useCharacterStore.getState>['character'],
    contentLevel = 0,
) => {
    if (!char) return null;
    const { equipment } = useInventoryStore.getState();
    const eq = getTotalEquipmentStats(equipment, ALL_ITEMS);
    const { skillLevels } = useSkillStore.getState();
    const tb = getTrainingBonuses(skillLevels, char.class);
    // 2026-05-25 NaN hardening (CLAUDE.md "NaN w combat = krytyczny bug —
    // waliduj WSZYSTKIE wartości przed obliczeniami, undefined/null -> 0"):
    // every numeric field read from `char` is defaulted via `?? 0` so a
    // partially-hydrated character (e.g. offline-mode snapshot mid-write,
    // a fresh row missing a column, or a corrupted save) cannot propagate
    // NaN through the engine. Without these defaults, the HUD HP bar /
    // damage rolls / crit checks would silently break — the player would
    // see "0/NaN HP" and any DMG = NaN comparison would always be false.
    const baseAttack       = char.attack       ?? 0;
    const baseDefense      = char.defense      ?? 0;
    const baseMaxHp        = char.max_hp       ?? 0;
    const baseMaxMp        = char.max_mp       ?? 0;
    const baseAttackSpeedV = char.attack_speed ?? 0;
    const baseCritChance   = char.crit_chance  ?? 0;
    const baseAttackSpeed = baseAttackSpeedV + eq.speed * 0.01 + tb.attack_speed;
    // Point 7: transform bonuses now apply LIVE instead of being baked at claim time.
    // Flat rewards add to the raw pool, percent rewards multiply the whole (base +
    // equip + training + elixir) total so they scale with future gear / training.
    const rawMaxHp = baseMaxHp + eq.hp + tb.max_hp + getElixirHpBonus() + getTransformFlatHp();
    const rawMaxMp = baseMaxMp + eq.mp + tb.max_mp + getElixirMpBonus() + getTransformFlatMp();
    const rawDefense = baseDefense + eq.defense + tb.defense + getElixirDefBonus() + getTransformFlatDefense();
    // Point N5: raw attack pool = base + equip + elixir + flat-transform, then
    // multiplied by the transform % bonus (Archer gets +7% per transform tier,
    // scaling with future gear/level).
    const gearGapMult = getGearGapMultiplier(getEquippedGearLevel(equipment), contentLevel);
    const rawAttack = (baseAttack + eq.attack + getElixirAtkBonus() + getTransformFlatAttack()) * gearGapMult;
    return {
        ...char,
        attack: Math.floor(rawAttack * getTransformAtkPctMultiplier()),
        defense: Math.floor(rawDefense * getTransformDefPctMultiplier()),
        max_hp: Math.floor(rawMaxHp * getElixirHpPctMultiplier() * getTransformHpPctMultiplier()),
        max_mp: Math.floor(rawMaxMp * getElixirMpPctMultiplier() * getTransformMpPctMultiplier()),
        attack_speed: baseAttackSpeed * getElixirAttackSpeedMultiplier(),
        crit_chance: Math.min(0.5, baseCritChance + eq.critChance * 0.01 + tb.crit_chance),
        crit_damage: (char.crit_damage ?? 2.0) + eq.critDmg * 0.01 + tb.crit_dmg,
        hp_regen: (char.hp_regen ?? 0) + tb.hp_regen + getTransformHpRegenFlat(),
        // 2026-06-24: mp_regen was missing `tb.mp_regen` (training) — asymmetric
        // with hp_regen above. Now both include base + training + transform so the
        // displayed regen exactly matches what the useMpRegen hook applies.
        mp_regen: (char.mp_regen ?? 0) + tb.mp_regen + getTransformMpRegenFlat(),
    };
};

// -- Drop / loot logic -------------------------------------------------------

export const dropLootToInventory = (monster: IMonster, monsterRarity: TMonsterRarity, heroicDropRate: number = 0): IDropDisplay[] => {
    const lootRolls = rollLoot(monster.level, monsterRarity, heroicDropRate);
    const { addItem, addGold } = useInventoryStore.getState();
    const { autoSellCommon, autoSellRare, autoSellEpic, autoSellLegendary, autoSellMythic } = useSettingsStore.getState();
    const drops: IDropDisplay[] = [];
    let autoSellGold = 0;

    for (const roll of lootRolls) {
        const inventoryItem = generateRandomItem(roll.itemLevel, roll.rarity);
        if (!inventoryItem) continue;

        const displayInfo = getItemDisplayInfo(inventoryItem.itemId);
        const displayName = displayInfo?.name_pl ?? formatItemName(roll.itemId);
        const icon = displayInfo?.icon ?? 'package';

        // Track drop rarity for quest progress
        useQuestStore.getState().addProgress('drop_rarity', roll.rarity, 1);

        const shouldAutoSell =
            (roll.rarity === 'common' && autoSellCommon) ||
            (roll.rarity === 'rare' && autoSellRare) ||
            (roll.rarity === 'epic' && autoSellEpic) ||
            (roll.rarity === 'legendary' && autoSellLegendary) ||
            (roll.rarity === 'mythic' && autoSellMythic);

        if (shouldAutoSell) {
            const sellPrice = getGeneratedSellPrice(roll.rarity, roll.itemLevel);
            autoSellGold += sellPrice;
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel, sold: true, soldPrice: sellPrice });
        } else {
            addItem(inventoryItem);
            drops.push({ icon, name: displayName, rarity: roll.rarity, upgradeLevel: inventoryItem.upgradeLevel });
        }
    }

    if (autoSellGold > 0) addGold(autoSellGold);

    // Stone drop
    const stone = rollStoneDrop(monster.level, monsterRarity);
    if (stone) {
        useInventoryStore.getState().addStones(stone.type, stone.count);
        const stoneRarity = stoneTypeToRarity(stone.type);
        const stoneLabel = STONE_NAMES_MAP[stone.type] ?? stone.type;
        drops.push({ icon: STONE_ICONS[stone.type] ?? 'gem-stone', name: `${stoneLabel} x${stone.count}`, rarity: stoneRarity });
    }

    // Potion drops
    const potionDrops = rollPotionDrop(monster.level);
    for (const pd of potionDrops) {
        useInventoryStore.getState().addConsumable(pd.potionId, pd.count);
        const potionInfo = ELIXIRS.find((e) => e.id === pd.potionId);
        const isHp = pd.potionId.includes('hp') || pd.potionId.includes('health');
        drops.push({ icon: isHp ? 'red-heart' : 'blue-heart', name: potionInfo?.name_pl ?? pd.potionId, rarity: 'common' });
    }

    // Spell chest drops — boss-rarity monsters with max mastery (25/25) also
    // roll the bonus heroic chest tier.
    const hasMaxMastery = useMasteryStore.getState().isMaxMastery(monster.id);
    const chestDrops = rollSpellChestDrop(monster.level, monsterRarity, false, false, hasMaxMastery);
    for (const cd of chestDrops) {
        useInventoryStore.getState().addSpellChest(cd.chestLevel, cd.count);
        drops.push({ icon: getSpellChestIcon(cd.chestLevel), name: getSpellChestDisplayName(cd.chestLevel), rarity: 'epic' });
    }

    return drops;
};

/**
 * Apply monster rarity multipliers to base monster stats.
 */
export const applyRarityToMonster = (baseMonster: IMonster, rarity: TMonsterRarity): IMonster => {
    if (rarity === 'normal') return baseMonster;
    const mult = MONSTER_RARITY_MULTIPLIERS[rarity];
    return {
        ...baseMonster,
        hp:      Math.floor(baseMonster.hp * mult.hp),
        attack:  Math.floor(baseMonster.attack * mult.atk),
        defense: Math.floor(baseMonster.defense * mult.def),
        xp:      Math.floor(baseMonster.xp * mult.xp),
        gold:    [
            Math.floor(baseMonster.gold[0] * mult.gold),
            Math.floor(baseMonster.gold[1] * mult.gold),
        ],
    };
};

// -- Auto-potion helpers -----------------------------------------------------

const useAutoPotionSlot = (
    potionId: string,
    enabled: boolean,
    threshold: number,
    currentVal: number,
    maxVal: number,
    onCooldown: boolean,
    healFn: (amount: number, max: number) => void,
    addLogFn: (text: string, type: 'player' | 'monster' | 'crit' | 'system' | 'loot' | 'block' | 'dodge' | 'dualwield') => void,
    startCdFn: (cdMs: number) => void,
    hpOrMp: 'hp' | 'mp',
    slotKind: 'flat' | 'pct' = 'flat',
): void => {
    if (!enabled || threshold <= 0 || onCooldown) return;
    // Safety: if current value is already at or above max, never fire a potion
    if (maxVal > 0 && currentVal >= maxVal) return;
    const missing = Math.max(0, maxVal - currentVal);
    const valPct = maxVal > 0 ? (currentVal / maxVal) * 100 : 100;
    if (valPct > threshold) return;
    const inv = useInventoryStore.getState();
    const autoLevel = useCharacterStore.getState().character?.level ?? 1;
    const elixir = resolveAutoPotionElixir(potionId, hpOrMp, slotKind, inv.consumables, autoLevel);
    if (!elixir) return;
    // Compute the would-be heal amount and skip if it would be mostly wasted.
    // This is the real guard against the "lost 1 HP, burned a 50 HP potion"
    // frustration — no matter what the % threshold says, we will never fire
    // a potion unless at least its heal amount of HP/MP is actually missing.
    const flatMatch = elixir.effect.match(hpOrMp === 'hp' ? /^heal_hp_(\d+)$/ : /^heal_mp_(\d+)$/);
    const pctMatch = elixir.effect.match(hpOrMp === 'hp' ? /^heal_hp_pct_(\d+)$/ : /^heal_mp_pct_(\d+)$/);
    let healAmount = 0;
    if (flatMatch) healAmount = parseInt(flatMatch[1], 10);
    else if (pctMatch) healAmount = Math.floor(maxVal * parseInt(pctMatch[1], 10) / 100);
    if (healAmount <= 0) return;
    if (missing < healAmount) return;
    inv.useConsumable(elixir.id);
    useDailyQuestStore.getState().addProgress('use_potion', 1);
    const cd = getPotionCooldownMs(elixir.id);
    if (cd > 0) startCdFn(cd);
    healFn(healAmount, maxVal);
    const pctText = pctMatch ? ` (${parseInt(pctMatch[1], 10)}%)` : '';
    addLogFn(`[Auto-Potion] ${elixir.name_pl} +${healAmount} ${hpOrMp.toUpperCase()}${pctText}`, 'system');
};

export const tryAutoPotion = (
    currentHp: number, maxHp: number,
    currentMp: number, maxMp: number,
): void => {
    const settings = useSettingsStore.getState();
    const cs = useCombatStore.getState();
    const cd = useCooldownStore.getState();

    const healHp = cs.healPlayerHp;
    const healMp = cs.healPlayerMp;
    const addLogFn = cs.addLog;

    const startHpCd = (ms: number) => useCooldownStore.getState().setHpPotionCooldown(ms);
    const startMpCd = (ms: number) => useCooldownStore.getState().setMpPotionCooldown(ms);
    const startPctHpCd = (ms: number) => useCooldownStore.getState().setPctHpCooldown(ms);
    const startPctMpCd = (ms: number) => useCooldownStore.getState().setPctMpCooldown(ms);

    // Slot 1: flat HP
    useAutoPotionSlot(settings.autoPotionHpId, settings.autoPotionHpEnabled, settings.autoPotionHpThreshold,
        currentHp, maxHp, cd.hpPotionCooldown > 0, healHp, addLogFn, startHpCd, 'hp', 'flat');

    // Slot 2: pct HP
    useAutoPotionSlot(settings.autoPotionPctHpId, settings.autoPotionPctHpEnabled, settings.autoPotionPctHpThreshold,
        currentHp, maxHp, cd.pctHpCooldown > 0, healHp, addLogFn, startPctHpCd, 'hp', 'pct');

    // Slot 1: flat MP
    useAutoPotionSlot(settings.autoPotionMpId, settings.autoPotionMpEnabled, settings.autoPotionMpThreshold,
        currentMp, maxMp, cd.mpPotionCooldown > 0, healMp, addLogFn, startMpCd, 'mp', 'flat');

    // Slot 2: pct MP
    useAutoPotionSlot(settings.autoPotionPctMpId, settings.autoPotionPctMpEnabled, settings.autoPotionPctMpThreshold,
        currentMp, maxMp, cd.pctMpCooldown > 0, healMp, addLogFn, startPctMpCd, 'mp', 'pct');
};

// -- Monster death handler ---------------------------------------------------

export const handleMonsterDeath = (currentMonsterRarity: TMonsterRarity): void => {
    const s = useCombatStore.getState();
    if (!s.monster) return;
    // 2026-05-11 CRITICAL BUG FIX ("knight zabil wiecej legendary niz archer"):
    // when we're a non-leader member of a multi-human party, the LEADER is
    // the authoritative reward processor. Their `handleMonsterDeath` applies
    // its own rewards then broadcasts `monster-killed`; the member's client
    // consumes the broadcast in `usePartyCombatSync` and runs
    // `applyMonsterKillRewardsForMember` (personal XP/gold/drops/tasks/
    // quests/mastery — one increment per kill).
    //
    // But the member's LOCAL engine might also see monsterCurrentHp drop
    // to 0 (auto-cast damage, leader's state broadcast pushing HP=0) and
    // fire `handleMonsterDeath` from the end-of-doPlayerAttackTick check
    // or similar. That double-applied EVERY reward: kill counter ×2, XP
    // ×2, drops ×2, task progress ×2. Knight saw 437 kills vs Archer's
    // 310 because Knight got both the local + broadcast increment.
    //
    // The fix: members SKIP local handleMonsterDeath entirely. All their
    // rewards arrive via the broadcast path. Leader still runs this
    // function normally as the single source of truth.
    {
        const partyState = usePartyStore.getState().party;
        const ch = useCharacterStore.getState().character;
        if (partyState && ch) {
            const otherHumans = partyState.members.filter((m) => m.id !== ch.id && !m.isBot);
            const isNonLeaderMember = otherHumans.length > 0 && partyState.leaderId !== ch.id;
            if (isNonLeaderMember) return;
        }
    }
    // Mastery N7: each mastery level grants +2% XP and +2% Gold (max +50% at lvl 25)
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(s.monster.id);
    const masteryXpMult = getMasteryXpMultiplier(masteryLevel);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);

    // 2026-05-09 spec: party bonuses. +0.5% drop, +6.5% XP per ALLY
    // (so 1 extra member = 1.005x drop / 1.065x XP, max 4 = 1.015x /
    // 1.195x). Counts every party member except the local player as
    // an ally. Bots count too — they help fight, they get a share.
    const partyState = usePartyStore.getState().party;
    const partySize = partyState ? Math.max(1, partyState.members.length) : 1;
    const partyDropMult = calculateDropMultiplier(partySize);
    const partyXpMult = calculateXpMultiplier(partySize);

    const baseGold = calculateGoldDrop(s.monster.gold);
    const gold = Math.floor(baseGold * masteryGoldMult);
    useInventoryStore.getState().addGold(gold);
    const heroicRate = useMasteryStore.getState().getMasteryBonuses(s.monster.id).heroic;
    // Lift the heroic chest rate by the party drop multiplier so groups
    // see slightly more rare drops (lootSystem doesn't know about party
    // size and the drop hooks don't take a multiplier parameter — this
    // is the only spot where we can splice the bonus in cleanly).
    const drops = dropLootToInventory(s.monster, currentMonsterRarity, heroicRate * partyDropMult);
    // 2026-05-11 spec ("obrazki w logach sa popsute"): some drops carry
    // an emoji icon (stones / potions / chests = 'gem-stone', 'red-heart', etc.) and
    // others carry an asset PATH (regular items via getItemDisplayInfo).
    // Paths render as raw `/src/assets/...` text in the log, which is
    // ugly + leaks asset routes. Strip path-style icons and keep only
    // safe emoji prefixes.
    const safeIcon = (icon: string): string => {
        if (!icon) return '';
        // Anything containing a slash or ending in .png/.svg/.jpg is a path.
        if (icon.includes('/') || /\.(png|svg|jpe?g|webp)$/i.test(icon)) return '';
        return icon;
    };
    const dropNames = drops.map(d => {
        const i = safeIcon(d.icon);
        return i ? `${i} ${d.name}` : d.name;
    }).join(', ');
    const waveHasMultiple = s.waveMonsters.length > 1;
    s.addLog(
        `${s.monster.name_pl} ginie! +${s.monster.xp} XP, +${gold} Gold${drops.length ? ` · Drop: ${dropNames}` : ''}`,
        'loot',
    );
    const bStore = useBuffStore.getState();
    // 2026-05-08: XP boost stacking — `xp_boost_100` (+100%) drains FIRST
    // when both 50% and 100% are active. Player gets the higher tier
    // applied; the lower one starts ticking only after the higher one
    // expires. Premium XP elixir stacks multiplicatively on top.
    const has100 = bStore.hasBuff('xp_boost_100');
    const has50 = bStore.hasBuff('xp_boost');
    const baseXpMult = has100
      ? bStore.getBuffMultiplier('xp_boost_100')
      : has50 ? bStore.getBuffMultiplier('xp_boost') : 1;
    const premiumXpMult = bStore.getBuffMultiplier('premium_xp_boost');
    const totalXpMult = baseXpMult * premiumXpMult;
    const finalXp = Math.floor(s.monster.xp * totalXpMult * masteryXpMult * partyXpMult);
    if (masteryLevel > 0) {
        const pct = Math.round((masteryXpMult - 1) * 100);
        s.addLog(`:fire: Mastery Lvl ${masteryLevel}: +${pct}% XP & Gold`, 'system');
    }
    s.addReward(finalXp, gold);
    // Consume pausable XP buff time — drain only the active tier (100%
    // first, 50% only when 100% is exhausted).
    if (bStore.hasBuff('premium_xp_boost')) bStore.consumePausableTime('premium_xp_boost', 2000);
    if (has100) bStore.consumePausableTime('xp_boost_100', 2000);
    else if (has50) bStore.consumePausableTime('xp_boost', 2000);
    // Skill XP boosts — 100% first, 50% only when 100% exhausted.
    if (bStore.hasBuff('skill_xp_boost_100')) bStore.consumePausableTime('skill_xp_boost_100', 2000);
    else if (bStore.hasBuff('skill_xp_boost')) bStore.consumePausableTime('skill_xp_boost', 2000);
    tickCombatElixirs(2000);
    // Snapshot base max HP/MP BEFORE addXp so we can compute level-up grants
    const preChar = useCharacterStore.getState().character;
    const preMaxHp = preChar?.max_hp ?? 0;
    const xpResult = useCharacterStore.getState().addXp(finalXp);
    if (xpResult.levelsGained > 0) {
        s.addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
    }
    if (totalXpMult > 1) {
        const boostParts: string[] = [];
        if (has100) boostParts.push('XP +100%');
        else if (has50) boostParts.push('XP +50%');
        if (premiumXpMult > 1) boostParts.push('Premium x2');
        s.addLog(`:star: ${boostParts.join(' + ')} aktywny! ${s.monster.xp} × ${totalXpMult} = ${finalXp} XP`, 'system');
    }
    // Persist HP/MP with level-up grants (re-read live combat store for fresh values).
    // On level-up: characterStore.addXp already full-heals HP/MP to the new max,
    // so we sync combat's live HP/MP to character.hp/mp (the source of truth).
    // On no level-up: we bump combat HP by the flat level-grant delta and persist.
    const postChar = useCharacterStore.getState().character;
    if (xpResult.levelsGained > 0) {
        // Full heal — mirror character.hp/mp (already =max) into combat store
        const fullHp = postChar?.hp ?? 0;
        const fullMp = postChar?.mp ?? 0;
        useCombatStore.getState().setHps(
            useCombatStore.getState().monsterCurrentHp,
            fullHp,
        );
        // setHps only touches playerCurrentHp; patch MP separately
        useCombatStore.setState({ playerCurrentMp: fullMp });
    } else {
        const live = useCombatStore.getState();
        const hpLevelGain = Math.max(0, (postChar?.max_hp ?? 0) - preMaxHp);
        // Clamp to effective max to prevent values > effMax in characterStore
        // (happens when buffs/elixirs expire between kills).
        const effForSync = getEffectiveChar(postChar);
        const syncMaxHp = effForSync?.max_hp ?? (postChar?.max_hp ?? 9999);
        const syncMaxMp = effForSync?.max_mp ?? (postChar?.max_mp ?? 9999);
        // Preserve live HP/MP across kills — neither HP nor MP auto-refills on
        // victory. Natural regen (useMpRegen / hp_regen) handles recovery between
        // fights, keeping skill MP costs meaningful across the whole session.
        useCharacterStore.getState().updateCharacter({
            hp: Math.min(syncMaxHp, Math.max(0, live.playerCurrentHp + hpLevelGain)),
            mp: Math.min(syncMaxMp, Math.max(0, live.playerCurrentMp)),
        });
    }
    void saveCurrentCharacterStores();
    // Track kills for tasks, quests, mastery
    const taskKills = MONSTER_RARITY_TASK_KILLS[currentMonsterRarity] ?? 1;
    useTaskStore.getState().addKill(s.monster.id, s.monster.level, taskKills);
    useQuestStore.getState().addProgress('kill', s.monster.id, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', currentMonsterRarity, 1, s.monster.level);
    useDailyQuestStore.getState().addProgress('kill_any', 1);
    useDailyQuestStore.getState().addProgress('earn_gold', gold);
    // Mastery uses the same rarity-weighted count as tasks so progress stays
    // in sync between the two — a legendary kill grants the same number of
    // units to both systems, and offline hunt (which already feeds weighted
    // kills into both) matches live combat.
    useMasteryStore.getState().addMasteryKills(s.monster.id, taskKills);
    // Update session stats
    useCombatStore.getState().addSessionStats(finalXp, gold);
    useCombatStore.getState().incrementSessionKill(currentMonsterRarity);

    // 2026-05-11 spec ("jezeli archer zabije 4 potwory to sojusznicy w tasku
    // tez maja te 4 potwory jako zabite"): broadcast the kill EARLY (before
    // the wave-advance branch) so members can apply their own rewards for
    // EVERY monster killed — AOE wipe-outs and sequential one-shots both
    // generate one kill-event per dead monster. Members consume in
    // `usePartyCombatSync` and run applyMonsterKillRewardsForMember which
    // adds task / quest / mastery progress to their own stores.
    // Also ship the leader's `finalXp` so every member gets identical XP
    // per kill (spec: "kazdy ma dostawac tyle samo XP").
    void broadcastMonsterKillIfInParty(s.monster, currentMonsterRarity, finalXp);

    // Wave-aware finalization: if more alive monsters exist, promote next target
    if (waveHasMultiple) {
        // Append drops to wave-accumulated drops (don't replace)
        useCombatStore.getState().appendDrops(drops);
        // Mark current active monster dead in wave
        useCombatStore.getState().markActiveWaveMonsterDead();
        // Try to advance to next alive target
        const advanced = useCombatStore.getState().advanceToNextWaveTarget();
        if (advanced) {
            // Continue fighting the next monster
            const next = useCombatStore.getState().monster;
            if (next) {
                useCombatStore.getState().addLog(
                    `:bullseye: Cel: ${next.name_pl} (${useCombatStore.getState().waveMonsters.filter(w => !w.isDead).length} żywych)`,
                    'system',
                );
            }
            // Do NOT set victory – stay in fighting phase
            return;
        }
        // No more alive monsters – wave cleared, show victory
        useCombatStore.getState().addLog(`:crossed-swords: Fala pokonana! (${s.waveMonsters.length} potworów)`, 'system');
        s.setPhase('victory');
        return;
    }

    // Single-monster path: standard victory (broadcast already fired above).
    useCombatStore.getState().setLastDrops(drops);
    s.setPhase('victory');
};

/** Helper: broadcast a kill-event when leader is in a multi-human party. */
const broadcastMonsterKillIfInParty = (monster: IMonster, rarity: TMonsterRarity, finalXp: number): void => {
    try {
        const partyState = usePartyStore.getState().party;
        const ch = useCharacterStore.getState().character;
        if (!partyState || !ch) return;
        const otherHumans = partyState.members.filter((m) => !m.isBot && m.id !== ch.id);
        if (otherHumans.length === 0) return;
        if (partyState.leaderId !== ch.id) return; // only leader broadcasts
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishMonsterKilled({
                monsterId:    monster.id,
                monsterLevel: monster.level,
                monsterRarity: rarity,
                finalXp,
            });
        }).catch(() => { /* offline */ });
    } catch { /* defensive */ }
};

/**
 * 2026-05-11: personal-reward path for non-leader members. Called when
 * the party-combat channel reports a `monster-killed` event from the
 * leader. Each member's client rolls THEIR OWN drops, applies THEIR
 * OWN XP (with their own mastery + party multiplier), bumps THEIR OWN
 * tasks / quests / mastery / session stats. State mutations (wave
 * advance, phase change, HP/MP sync) are NOT done here — those come
 * via the leader's state broadcast.
 */
export const applyMonsterKillRewardsForMember = (
    monsterId: string,
    monsterLevel: number,
    rarity: TMonsterRarity,
    finalXpFromLeader: number,
): void => {
    const monster = (monstersRaw as unknown as IMonster[]).find((m) => m.id === monsterId);
    if (!monster) return;
    const s = useCombatStore.getState();
    // 2026-05-11 spec ("kazdy ma dostawac tyle samo XP"): use the LEADER's
    // computed final XP for THIS kill instead of recomputing with our own
    // mastery + buffs. That guarantees identical XP/h across the party
    // for the same kill stream. Mastery progress is still per-character
    // (addMasteryKills below); only the XP REWARD is normalised.
    // Gold + drops stay per-character independent (separate RNG rolls,
    // so each player can drop different items — per spec).
    const masteryLevel = useMasteryStore.getState().getMasteryLevel(monsterId);
    const masteryGoldMult = getMasteryGoldMultiplier(masteryLevel);
    const partyState = usePartyStore.getState().party;
    const partySize = partyState ? Math.max(1, partyState.members.length) : 1;
    const partyDropMult = calculateDropMultiplier(partySize);

    // Personal gold roll
    const baseGold = calculateGoldDrop(monster.gold);
    const gold = Math.floor(baseGold * masteryGoldMult);
    useInventoryStore.getState().addGold(gold);

    // Personal drop roll (each member's own RNG)
    const heroicRate = useMasteryStore.getState().getMasteryBonuses(monsterId).heroic;
    const drops = dropLootToInventory(monster, rarity, heroicRate * partyDropMult);
    // 2026-05-11: drop log uses safe-icon helper — same as handleMonsterDeath
    // so member's log doesn't bleed asset paths.
    const safeIcon = (icon: string): string => {
        if (!icon) return '';
        if (icon.includes('/') || /\.(png|svg|jpe?g|webp)$/i.test(icon)) return '';
        return icon;
    };
    const dropNames = drops.map((d) => {
        const i = safeIcon(d.icon);
        return i ? `${i} ${d.name}` : d.name;
    }).join(', ');
    s.addLog(
        `${monster.name_pl} ginie! +${finalXpFromLeader} XP, +${gold} Gold${drops.length ? ` · Drop: ${dropNames}` : ''}`,
        'loot',
    );

    // Use leader's XP value verbatim — same XP for everyone in the party.
    s.addReward(finalXpFromLeader, gold);
    const xpResult = useCharacterStore.getState().addXp(finalXpFromLeader);
    if (xpResult.levelsGained > 0) {
        s.addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk)`, 'system');
    }

    // Personal task / quest / mastery progress
    const taskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
    useTaskStore.getState().addKill(monsterId, monsterLevel, taskKills);
    useQuestStore.getState().addProgress('kill', monsterId, taskKills);
    useQuestStore.getState().addProgress('kill_rarity', rarity, 1, monsterLevel);
    useDailyQuestStore.getState().addProgress('kill_any', 1);
    useDailyQuestStore.getState().addProgress('earn_gold', gold);
    useMasteryStore.getState().addMasteryKills(monsterId, taskKills);

    // Personal session stats
    useCombatStore.getState().addSessionStats(finalXpFromLeader, gold);
    useCombatStore.getState().incrementSessionKill(rarity);

    // Append drops to wave-accumulated drops so the backpack popup
    // shows what THIS player got.
    useCombatStore.getState().appendDrops(drops);

    // Persist (throttled) so the level/XP/gold/inventory ride to the
    // server within a few seconds.
    void saveCurrentCharacterStores();
};

// 2026-05-12: post-exit grace window. When a non-leader member calls
// `stopCombat()` from "Zakończ polowanie", we set this timestamp. For
// `PARTY_EXIT_GRACE_MS` after that, ANY trigger of `handlePlayerDeath`
// on this client is silently dropped — even if `usePartyStore.party`
// has already been cleared to `null` (so the synchronous party-based
// gate below misses). This covers async race windows between
// `stopCombat`, `leaveParty`, and queued death triggers from earlier
// in-flight engine ticks / broadcasts.
const PARTY_EXIT_GRACE_MS = 15_000;
let _partyExitGraceUntil = 0;

/** Internal: stopCombat calls this for non-leader members so the grace
 *  window covers any delayed death attempts during the navigation. */
const markPartyExitGrace = (): void => {
    _partyExitGraceUntil = Date.now() + PARTY_EXIT_GRACE_MS;
};

// -- Player death handler ----------------------------------------------------

export const handlePlayerDeath = (forceConfirm: boolean = false): void => {
    const s = useCombatStore.getState();
    const char = useCharacterStore.getState().character;
    if (!char) return;
    // 2026-05-12 CRITICAL FIX ("za kazdym razem umieram po Zakoncz polowanie"):
    // for a non-leader member of a multi-human party, the player's HP/death
    // state is leader-authoritative — the LEADER's broadcast of `member-hit`
    // is the ONLY legitimate source of damage. Any LOCAL trigger of
    // `handlePlayerDeath` for a member is a bug. We gate on two
    // conditions to catch ALL the races:
    //
    // 1. Synchronous member check — works when party is still set.
    // 2. Time-window grace — covers the gap between `leaveParty()`
    //    resolving (party->null) and any delayed death trigger from
    //    queued ticks / pending broadcasts. Without this, a death
    //    fired ~100 ms after Wyjdź lands when party is already null
    //    and the sync gate misses, costing the member -17 levels.
    if (Date.now() < _partyExitGraceUntil) {
        // Defensive heal so the next view doesn't render the member
        // as a corpse with 0 HP (member-hits accumulated character.hp
        // down during the fight).
        if ((char.hp ?? 0) <= 0) {
            useCharacterStore.getState().fullHealEffective();
        }
        return;
    }
    {
        const partyState = usePartyStore.getState().party;
        if (partyState && char.id) {
            const otherHumans = partyState.members.filter((m) => m.id !== char.id && !m.isBot);
            const isNonLeaderMember = otherHumans.length > 0 && partyState.leaderId !== char.id;
            if (isNonLeaderMember) {
                if ((char.hp ?? 0) <= 0) {
                    useCharacterStore.getState().fullHealEffective();
                }
                return;
            }
            // 2026-05-14 spec ("port the death popup/handoff to hunt"):
            // when the LEADER dies in a multi-human party, don't run
            // the auto-death sequence yet. Combat.tsx watches HP and
            // shows the PartyDeathChoice popup so the player can pick
            // between bailing to town (apply penalty NOW + handoff
            // leadership) or waiting for an ally Cleric to revive them
            // (Aura Wskrzeszenia heals dead allies to 50% HP). The
            // popup's "Wróć do miasta" button re-calls this with
            // forceConfirm=true to push through.
            //
            // We DON'T heal the player here — leaving HP at 0 lets the
            // popup render over a visually-dead character card, and
            // also keeps the engine's natural "I'm dead, skip my
            // swings" gates in effect until someone revives us.
            const isLeaderInMultiHumanParty = otherHumans.length > 0 && partyState.leaderId === char.id;
            if (isLeaderInMultiHumanParty && !forceConfirm) {
                return;
            }
        }
    }

    const monsterName = s.monster
        ? (s.monsterRarity && s.monsterRarity !== 'normal'
            ? `${s.monster.name_pl} [${s.monsterRarity}]`
            : s.monster.name_pl)
        : 'Nieznany';
    const monsterLevel = s.monster?.level ?? 0;

    if (s.monster) {
        if (isBackendMode() && char) {
            void backendApi.logDeath(char.id, {
                source: 'monster',
                source_name: monsterName,
                source_level: monsterLevel,
                result: 'killed',
            });
        } else {
            void deathsApi.logDeath({
                character_id: char.id,
                character_name: char.name,
                character_class: char.class,
                character_level: char.level,
                source: 'monster',
                source_name: monsterName,
                source_level: monsterLevel,
            });
        }
    }

    // 2026-06-21: either protection item (death_protection elixir OR amulet of
    // loss) shields EVERYTHING — no level/xp/skill/item loss — and consumes ONE.
    const prot = consumeDeathProtection();

    useCharacterStore.getState().fullHealEffective();

    const oldLevel = char.level;
    let newLevel = char.level;
    let levelsLost = 0;
    let xpPercent = 100;

    if (prot.isProtected) {
        const label = prot.consumedId === 'death_protection' ? 'Eliksir Ochrony' : 'Amulet of Loss';
        s.addLog(`:shield: ${label} uchronił Cię od wszystkich strat (poziom, XP, przedmioty)!`, 'system');
    } else {
        const penalty = applyDeathPenalty(char.level, char.xp);
        newLevel = penalty.newLevel;
        levelsLost = penalty.levelsLost;
        xpPercent = penalty.xpPercent;
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
        const skillPctTxt = `-${penalty.skillXpLossPercent}% Skill XP`;
        if (penalty.levelsLost > 0) {
            s.addLog(`Giniesz… Tracisz ${penalty.levelsLost} poziom${penalty.levelsLost === 1 ? '' : 'y'}! ${char.level} -> ${penalty.newLevel} · ${skillPctTxt}`, 'system');
        } else {
            s.addLog(`Giniesz… ${skillPctTxt}`, 'system');
        }
        // Items are lost on UNPROTECTED death only, and only from level 51+ —
        // the lvl 1-50 beginner grace is enforced inside applyDeathItemLoss
        // (it returns 0 for graced levels). The level/XP/skill penalty above
        // still applies.
        const itemsLost = useInventoryStore.getState().applyDeathItemLoss(false, char.level);
        if (itemsLost > 0) {
            s.addLog(`:skull: Straciłeś ${itemsLost} przedmiot(ów) przy śmierci!`, 'system');
        }
    }

    // Force-save: death is a once-in-a-while event, not part of the
    // hot kill loop — bypass the 4 s throttle so the loss persists
    // to Supabase immediately.
    void saveCurrentCharacterStoresForce();

    // Stop all combat (background included) and trigger epic death overlay
    s.resetCombat();
    useBotStore.getState().clearBots();
    clearHuntNecroSummons();
    resetAggro();

    useDeathStore.getState().triggerDeath({
        killedBy: monsterName,
        sourceLevel: monsterLevel,
        oldLevel,
        newLevel,
        levelsLost,
        xpPercent,
        protectionUsed: prot.isProtected,
        source: 'monster',
    });
};

// -- Player attack tick ------------------------------------------------------

export const doPlayerAttackTick = (autoSkillOnly = false): void => {
    const s = useCombatStore.getState();
    // Gear-gap penalty: pass the hunted monster's level so an under-geared
    // player deals proportionally less damage (basic + skills + summons all
    // derive from this `char.attack`). Only the human player is penalized here.
    const char = getEffectiveChar(useCharacterStore.getState().character, s.monster?.level ?? 0);
    const skillSettings = useSettingsStore.getState();
    if (s.phase !== 'fighting' || !s.monster || !char) return;
    // Stun gate — paralysed players can't swing or auto-cast.
    if (isHuntPlayerStunned()) return;
    // 2026-05-14 spec ("port death popup/handoff to hunt"): leader who
    // hit 0 HP in a multi-human party sits dead-but-waiting (popup
    // open or "Czekaj na wskrzeszenie" picked). The fight keeps
    // ticking via bots + monster swings, but the corpse must not
    // keep swinging — mirrors Boss.tsx's `playerHpRef.current <= 0`
    // bail in doPlayerAttack.
    if (s.playerCurrentHp <= 0) return;

    // 2026-05-11 spec ("wspolna walka — knight tez bije"): when we're a
    // non-leader member of a multi-human party the leader's engine is
    // authoritative for monster HP. Our local engine still ticks at
    // our attack-speed cadence so auto-skill cooldowns fire on time
    // (see auto-skill block at the bottom of this fn), but the basic
    // basic-attack damage is diverted to an `attack-action` broadcast
    // instead of applying locally. The leader receives, applies on
    // their authoritative monster, then re-broadcasts a damage-event
    // that every client renders.
    const liveCharRaw = useCharacterStore.getState().character;
    const partyState = usePartyStore.getState().party;
    const otherHumans = partyState?.members.filter((m) => m.id !== liveCharRaw?.id && !m.isBot) ?? [];
    const isNonLeaderMember = !!(
        partyState && liveCharRaw &&
        otherHumans.length > 0 &&
        partyState.leaderId !== liveCharRaw.id
    );

    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;
    const isDualWield = !!classConfig.dualWield;

    // Single hit helper
    const doSingleHit = (hand: 'left' | 'right' | undefined, weaponRollFn: () => number, dmgPercent: number) => {
        const freshS = useCombatStore.getState();
        if (freshS.phase !== 'fighting' || !freshS.monster) return 0;
        const wRoll = Math.floor(weaponRollFn() * dmgPercent);
        // 2026-05 v6: read + consume the player's "next basic" buffs from the
        // v2 status session. Without this, Precyzyjny Strzał's +30% crit
        // chance / Klon Cienia's ×2 dmg / Knight Ostateczny's guaranteed
        // crit / Cięcie Boga's chained crit_next never actually fired on
        // the swing that followed the cast — the queue was filled but no
        // basic-attack code-path read it.
        const playerStatus = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
        const mods = consumeCasterBasicHitMods(playerStatus);
        // Mirror to BuffStore so the visible charge counter drains.
        syncCasterChargeConsume(mods.consumed);
        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: freshS.monster.defense,
            critChance: (char.crit_chance ?? 0.05) + classBonus.extraCritChance + mods.extraCritChance,
            maxCritChance: maxCrit,
            isCrit: mods.forceCrit ? true : undefined,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier() * mods.dmgMult,
        });
        // Necromancer Klątwa Śmierci (mark_amp) — first hit on the
        // marked target consumes the charge and bumps damage ×N.
        const targetSt = ensureStatus(huntEffects, huntMonsterFxId(freshS.activeTargetIdx, freshS.monster.id));
        const amp = consumeTargetMarkAmp(targetSt);
        if (amp.mult !== 1) {
            r.finalDamage = Math.max(1, Math.floor(r.finalDamage * amp.mult));
        }
        freshS.dealToMonster(r.finalDamage);
        // Emit combat event for animations (only if on combat view)
        const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
        let text = `${handPrefix}Atakujesz ${freshS.monster.name_pl} za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' :high-voltage:KRYTYK!';
        if (r.isBlocked) text += ' (zablokowane)';
        freshS.addLog(text, hand ? (r.isCrit ? 'crit' : 'dualwield') : (r.isCrit ? 'crit' : 'player'));
        // Snapshot the target index AT THE MOMENT we deal damage. Without
        // this, Combat.tsx reads `activeTargetIdx` from the store later in
        // its React effect — and if the hit killed the monster, the engine
        // has already advanced `activeTargetIdx` to the next alive slot, so
        // the per-class attack animation pops on the WRONG card (most
        // visibly: the very first enemy's death never animates because the
        // engine immediately moves the cursor to slot 1).
        useCombatStore.getState().emitCombatEvent({
            type: 'monsterHit',
            data: {
                damage: r.finalDamage,
                isCrit: r.isCrit,
                isBlocked: r.isBlocked,
                hand: hand ?? null,
                targetIdx: freshS.activeTargetIdx,
            },
            timestamp: Date.now(),
        });
        // 2026-05-11 spec ("widziec animacje wszystkich"): broadcast
        // the leader's swing as a damage-event so every party member
        // renders the same floating number + hit flash on their copy
        // of the arena. Members who deal damage via attack-action
        // also get a damage-event echoed back from the leader so they
        // see their own hit animate.
        {
            const liveCh = useCharacterStore.getState().character;
            const ps = usePartyStore.getState().party;
            const otherH = ps?.members.filter((m) => m.id !== liveCh?.id && !m.isBot) ?? [];
            const isLeaderInParty = !!(
                ps && liveCh && otherH.length > 0 && ps.leaderId === liveCh.id
            );
            if (isLeaderInParty) {
                import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishDamageEvent({
                        attackerId:   liveCh!.id,
                        attackerName: liveCh!.name,
                        damage:       r.finalDamage,
                        isCrit:       r.isCrit,
                        targetIdx:    freshS.activeTargetIdx,
                        hand:         hand ?? null,
                    });
                }).catch(() => { /* offline */ });
            }
        }
        return r.finalDamage;
    };

    // Execute attack(s)
    let totalDamage = 0;
    // 2026-05-11: when called with autoSkillOnly=true, skip the basic
    // attack entirely — the fast auto-skill interval calls us purely
    // to fire ready spells without spamming basic-attack swings at
    // 4x the intended attack speed.
    if (autoSkillOnly) {
        // Skip basic attack section entirely.
    } else if (isNonLeaderMember && liveCharRaw) {
        // Member path: skip local damage; broadcast attack-action so
        // the leader applies on their authoritative state. We still
        // call calculateDamage with the player's own stats so the
        // damage value reflects their gear/training/crit chance.
        const wRoll = Math.floor(rollWeaponDamage() * 1.0);
        const r = calculateDamage({
            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
            enemyDefense: s.monster.defense,
            critChance: (char.crit_chance ?? 0.05) + classBonus.extraCritChance,
            maxCritChance: maxCrit,
            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
        });
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishAttackAction({
                attackerId:   liveCharRaw.id,
                attackerName: liveCharRaw.name,
                damage:       r.finalDamage,
                isCrit:       r.isCrit,
                targetIdx:    s.activeTargetIdx,
                hand:         null,
            });
        }).catch(() => { /* offline */ });
        totalDamage += r.finalDamage;
    } else if (isDualWield) {
        totalDamage += doSingleHit('left', rollWeaponDamage, 0.6);
        // Hit 2 150ms later
        setTimeout(() => {
            const dmg2 = doSingleHit('right', rollOffHandDamage, 0.6);
            if (dmg2 > 0) useDailyQuestStore.getState().addProgress('deal_damage', dmg2);
            const s2 = useCombatStore.getState();
            if (s2.monsterCurrentHp <= 0 && s2.phase === 'fighting') {
                handleMonsterDeath(s2.monsterRarity);
            }
        }, 150);
    } else {
        totalDamage += doSingleHit(undefined, rollWeaponDamage, 1.0);
    }
    // 2026-05 v6: party_as_up (Mage Time Warp / Bard Ballada Bohaterów /
    // Boska Melodia / Pieśń Wszechświata) — caster status carries asMult
    // (e.g. 1.5×). At asMult=2.0 the player should swing twice per
    // attack tick; at 1.5× they swing 1.5× on average (50% chance of an
    // extra swing each tick).
    const psAs = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    if (!autoSkillOnly && psAs.asMultMs > 0 && psAs.asMult > 1) {
        const bonus = psAs.asMult - 1; // e.g. 1.5 -> 0.5
        const guaranteed = Math.floor(bonus);
        const fractional = bonus - guaranteed;
        const extra = guaranteed + (Math.random() < fractional ? 1 : 0);
        for (let i = 0; i < extra; i++) {
            setTimeout(() => {
                const ss = useCombatStore.getState();
                if (ss.phase !== 'fighting' || !ss.monster) return;
                doSingleHit(undefined, rollWeaponDamage, 1.0);
                const after = useCombatStore.getState();
                if (after.monsterCurrentHp <= 0 && after.phase === 'fighting') {
                    handleMonsterDeath(after.monsterRarity);
                }
            }, 80 * (i + 1));
        }
    }

    // Necromancer summon swing — every live summon swings INDEPENDENTLY
    // of the player's basic attack. Each summon emits its own
    // `monsterHit` event (with isSummon + summonType payload) so the
    // view can flash a distinct float per summon (skel :skull-and-crossbones: / ghost :ghost: /
    // demon :smiling-face-with-horns: / lich :crown:) rather than one combined sum. Display order
    // is type-priority (skel first, lich last) — matches the avatar
    // damage-soak order.
    if (!autoSkillOnly && char.class === 'Necromancer') {
        const liveSummons = useNecroSummonStore.getState().summons[HUNT_PLAYER_FX_ID] ?? [];
        if (liveSummons.length > 0) {
            const SUMMON_TYPE_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
            const sorted = [...liveSummons].sort((a, b) => SUMMON_TYPE_RANK[a.type] - SUMMON_TYPE_RANK[b.type]);
            sorted.forEach((sm, idx) => {
                window.setTimeout(() => {
                    const freshS = useCombatStore.getState();
                    if (freshS.phase !== 'fighting' || !freshS.monster) return;
                    const targetIdx = freshS.activeTargetIdx;
                    const wm = freshS.waveMonsters[targetIdx];
                    if (!wm || wm.isDead) return;
                    let dmg = Math.max(1, Math.floor(char.attack * sm.dmgMult) - Math.floor(freshS.monster.defense * 0.5));
                    // 2026-05 v7: summon swings consume Klątwa Śmierci
                    // (count mark) AND get the Kraina Śmierci (duration
                    // mark) ×mult the same as the necro's own swing.
                    const ampSum = consumeHuntMonsterMarkAmp(targetIdx, freshS.monster.id);
                    if (ampSum.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampSum.mult));
                    }
                    useCombatStore.getState().damageWaveMonster(targetIdx, dmg);
                    freshS.addLog(`:skull: ${sm.type}: ${dmg} dmg`, 'player');
                    useCombatStore.getState().emitCombatEvent({
                        type: 'monsterHit',
                        data: {
                            damage: dmg, isCrit: false, isBlocked: false,
                            hand: null, targetIdx,
                            isSummon: true,
                            summonType: sm.type,
                        },
                        timestamp: Date.now(),
                    });
                }, 80 + idx * 100);
            });
            // Tally for the function's totalDamage return — best-
            // effort sum (real damage applied via setTimeout above).
            const totalSummon = sorted.reduce((s, sm) => s + Math.max(1, Math.floor(char.attack * sm.dmgMult)), 0);
            totalDamage += totalSummon;
        }
    }

    // Weapon/MLVL XP — only on actual swings, not on auto-skill-only
    // polls (avoids double-counting XP at the fast tick rate).
    if (!autoSkillOnly) {
        useSkillStore.getState().addMlvlXpFromAttack(char.class as any);
        useSkillStore.getState().addWeaponSkillXpFromAttack(char.class as any);
    }

    // AUTO skill logic
    if (skillSettings.skillMode === 'auto') {
        const slots = useSkillStore.getState().activeSkillSlots;
        const now = Date.now();
        const speedMult = SPEED_MULT[skillSettings.combatSpeed] ?? 1;
        for (const skillId of slots) {
            if (!skillId) continue;
            const lastUsed = skillCooldownMap.get(skillId) ?? 0;
            if ((now - lastUsed) * speedMult < SKILL_COOLDOWN_MS) continue;
            const autoMpCost = getSkillMpCost(skillId);
            if (s.playerCurrentMp < autoMpCost) continue;
            // 2026-05 v6: pull skill def + classify cast affinity:
            //   - damage > 0 -> damage hit, animate on enemy
            //   - damage = 0 + enemy-debuff atom (Pułapka stun, Strzała
            //     Wiatru) -> animate on enemy, no number
            //   - damage = 0 + self-buff only (Orle Oko, Bomba Dymna) ->
            //     animate on player avatar
            const sDef = getSkillDef(skillId);
            const skillMult = sDef?.damage ?? 0;
            const isDamageHit = skillMult > 0;
            const targetsEnemy = isDamageHit || skillTargetsEnemy(sDef?.effect ?? null);
            // Apply v2 skill effects FIRST so we know `defPenPct` for the
            // damage roll (Strzał Snajpera + def_pen:100 must drop monster
            // defense to 0 BEFORE we compute the spell hit).
            // 2026-05-11: if the active slot is dead (basic attack killed
            // it just before this auto-cast tick) huntApplySkillEffectV2
            // returns null. Skip the cast entirely — MP / cooldown stay
            // untouched and the slot is free to fire on the next ready
            // monster instead.
            const effApply = huntApplySkillEffectV2(skillId, s.activeTargetIdx);
            if (effApply === null) continue;
            const autoDefPenFrac = Math.max(0, Math.min(1, (effApply?.defPenPct ?? 0) / 100));
            const autoEffectiveDef = Math.max(0, Math.floor(s.monster.defense * (1 - autoDefPenFrac)));
            // Skill-upgrade combat bonus — hunt is solo, so this is always the
            // local player's own cast. Modest & capped; folded into the skill's
            // damage multiplier so it scales primary + AOE splash uniformly.
            const skillUpgradeMult = getCombatSkillUpgradeMultiplier(
                useSkillStore.getState().skillUpgradeLevels[skillId] ?? 0,
            );
            const sr = calculateDamage({
                baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                skillBonus: Math.floor(char.attack * 0.5),
                classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                enemyDefense: autoEffectiveDef,
                critChance: 0.20,
                maxCritChance: maxCrit,
                damageMultiplier: isDamageHit
                    ? getAtkDamageMultiplier() * getSpellDamageMultiplier() * getTransformDmgMultiplier() * skillMult * skillUpgradeMult
                    : 0,
            });
            // Track every slot the AOE actually splashed onto so we can
            // later tell the view to fire animations + floating-dmg
            // numbers on each one (the manual cast path in Combat.tsx
            // does this inline; auto-cast events used to only carry the
            // primary target so AOE spells looked like single-target).
            const aoeTargetIdxs: number[] = [];
            // 2026-05 v7: total damage dealt this cast (primary + every
            // splash that landed). Drives Żniwa Dusz heal_self_pct_dmg
            // so AOE casts heal on the SUM, not just the primary.
            let totalDmgDealtThisCast = 0;
            // instant_kill_chance execute-burst on the PRIMARY target (finite
            // ~12%-of-max-HP hit). Shipped in the skillAnim event so the view
            // renders a DEATH ATTACK float with the actual burst damage.
            let primaryExecuteBurstDmg = 0;
            if (isDamageHit) {
                if (effApply?.instantKill) {
                    const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                    if (wm) {
                        useCombatStore.getState().damageWaveMonster(s.activeTargetIdx, wm.currentHp);
                        totalDmgDealtThisCast += wm.currentHp;
                    }
                } else {
                    // 2026-05 v7: auto-skill spell consumes Klątwa AND
                    // gets Kraina ×N. Manual cast in Combat.tsx already
                    // does this via consumeHuntMonsterMarkAmp(744); auto
                    // path stayed at base damage until now.
                    // instant_kill_chance success → finite execute burst
                    // (12% of target max HP, or the normal hit if bigger),
                    // NOT a one-shot.
                    let primaryDmg = sr.finalDamage;
                    if ((effApply?.executeBurstPct ?? 0) > 0) {
                        const wm = useCombatStore.getState().waveMonsters[s.activeTargetIdx];
                        const burst = Math.floor((wm?.maxHp ?? 0) * (effApply!.executeBurstPct) / 100);
                        primaryDmg = Math.max(primaryDmg, burst);
                        primaryExecuteBurstDmg = primaryDmg;
                    }
                    const ampPrimary = consumeHuntMonsterMarkAmp(s.activeTargetIdx, s.monster.id);
                    if (ampPrimary.mult !== 1) {
                        primaryDmg = Math.max(1, Math.floor(primaryDmg * ampPrimary.mult));
                    }
                    s.dealToMonster(primaryDmg);
                    totalDmgDealtThisCast += primaryDmg;
                    if (effApply?.aoe) {
                        // Primary 100% / splash 75% (AOE falloff).
                        const splashDmg = Math.max(1, Math.floor(primaryDmg * 0.75));
                        // Per-target IK roll for AOE — each splash monster
                        // gets its own instant_kill_chance%. Tracked in
                        // a separate set so the view can render DEATH
                        // ATTACK on the right slots.
                        const splashIkPct = effApply?.instantKillPct ?? 0;
                        const wave = useCombatStore.getState().waveMonsters;
                        for (let ii = 0; ii < wave.length; ii++) {
                            if (ii === s.activeTargetIdx) continue;
                            if (wave[ii].isDead) continue;
                            const splashIk = splashIkPct > 0 && Math.random() * 100 < splashIkPct;
                            if (splashIk) {
                                // AOE re-roll of instant_kill_chance → finite
                                // execute burst (12% of splash target max HP,
                                // or the normal splash if bigger), not a kill.
                                const ikDmg = Math.max(splashDmg, Math.floor(wave[ii].maxHp * 12 / 100));
                                useCombatStore.getState().damageWaveMonster(ii, ikDmg);
                                totalDmgDealtThisCast += ikDmg;
                            } else {
                                // 2026-05 v7: each splash target rolls
                                // its own markAmp consume — Kraina Śmierci
                                // marks every AOE'd enemy and the splash
                                // damage on each one should ×2 too.
                                let thisSplash = splashDmg;
                                const ampSplash = consumeHuntMonsterMarkAmp(ii, wave[ii].monster.id);
                                if (ampSplash.mult !== 1) {
                                    thisSplash = Math.max(1, Math.floor(thisSplash * ampSplash.mult));
                                }
                                useCombatStore.getState().damageWaveMonster(ii, thisSplash);
                                totalDmgDealtThisCast += thisSplash;
                            }
                            aoeTargetIdxs.push(ii);
                        }
                    }
                }
                // Heal-on-cast effects (void_ray etc.). Capture pre/post
                // HP so the float shows the ACTUAL healed amount (capped
                // at max_hp). Emits a playerHit-style event with a
                // `spellHealAmount` field that Combat.tsx renders as a
                // green ally float on the player slot.
                //
                // 2026-05 v7: Use TOTAL damage dealt (primary + splash)
                // for AOE casts so Żniwa Dusz heals on the full sum
                // instead of just the primary target.
                if (effApply && effApply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                    const heal = Math.floor(totalDmgDealtThisCast * (effApply.healCasterPctOfDmg / 100));
                    const beforeHp = useCombatStore.getState().playerCurrentHp;
                    useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                    const afterHp = useCombatStore.getState().playerCurrentHp;
                    const actual = afterHp - beforeHp;
                    useCombatStore.getState().emitCombatEvent({
                        type: 'playerHit',
                        data: {
                            damage: 0, isCrit: false, isBlocked: false,
                            hpDamage: 0, mpDamage: 0,
                            isSpellHeal: true,
                            spellHealAmount: actual,
                            spellHealRequested: heal,
                        },
                        timestamp: Date.now(),
                    });
                }
            }
            // 2026-05 v6: Cleric `heal` / `holy_nova` auto-cast. Pure
            // heal spells (damage:0) hit the !isDamageHit path; the
            // heal logic must live OUTSIDE the damage-hit gate above
            // or it never fires for Cleric `heal` (which only has
            // heal_lowest_ally_pct, no damage). Picks the lowest HP%
            // ally (player + alive bots), heals them N% of their max.
            // Uses playerHit + isSpellHeal so Combat.tsx renders the
            // green +HP float on the player when THEY were lowest;
            // bots are healed silently via botStore.
            if (effApply && effApply.healLowestAllyPct > 0) {
                const aliveBots = useBotStore.getState().bots.filter((b) => b.alive);
                const playerHp = useCombatStore.getState().playerCurrentHp;
                let lowestKind: 'player' | 'bot' = 'player';
                let lowestRatio = playerHp / Math.max(1, char.max_hp);
                let lowestBotIdx = -1;
                for (let i = 0; i < aliveBots.length; i++) {
                    const ratio = aliveBots[i].hp / Math.max(1, aliveBots[i].maxHp);
                    if (ratio < lowestRatio) {
                        lowestKind = 'bot';
                        lowestRatio = ratio;
                        lowestBotIdx = i;
                    }
                }
                if (lowestKind === 'player') {
                    const heal = Math.floor(char.max_hp * (effApply.healLowestAllyPct / 100));
                    const before = useCombatStore.getState().playerCurrentHp;
                    useCombatStore.getState().healPlayerHp(heal, char.max_hp);
                    const after = useCombatStore.getState().playerCurrentHp;
                    const actual = after - before;
                    if (heal > 0) {
                        useCombatStore.getState().emitCombatEvent({
                            type: 'playerHit',
                            data: {
                                damage: 0, isCrit: false, isBlocked: false,
                                hpDamage: 0, mpDamage: 0,
                                isSpellHeal: true,
                                spellHealAmount: actual,
                                spellHealRequested: heal,
                            },
                            timestamp: Date.now(),
                        });
                    }
                } else if (lowestBotIdx >= 0) {
                    const bot = aliveBots[lowestBotIdx];
                    const heal = Math.floor(bot.maxHp * (effApply.healLowestAllyPct / 100));
                    const newHp = Math.min(bot.maxHp, bot.hp + heal);
                    useBotStore.getState().updateBotHp(bot.id, newHp);
                }
            }
            // 2026-05 v6: Cleric Aura Wskrzeszenia auto-cast. Revive
            // every dead bot to 50% HP. Player can't be dead in Hunt
            // (death triggers the run-end overlay, ending the engine
            // tick) so this only ever raises bot allies.
            if (effApply && effApply.reviveDeadAllies) {
                const allBots = useBotStore.getState().bots;
                const revivedNames: string[] = [];
                for (const bot of allBots) {
                    if (!bot.alive) {
                        const reviveHp = Math.max(1, Math.floor(bot.maxHp * 0.5));
                        useBotStore.getState().updateBotHp(bot.id, reviveHp);
                        revivedNames.push(bot.name);
                    }
                }
                if (revivedNames.length > 0) {
                    s.addLog(`:sparkles: ${skillId}: wskrzeszono ${revivedNames.join(', ')}`, 'system');
                }
            }
            // Multistrike (Wielostrzał) — schedule N follow-up basic attacks
            // on the SAME slot, ~120ms apart so they read as a quick burst.
            if ((effApply?.multistrike ?? 0) > 0) {
                const extra = Math.max(0, Math.floor(effApply!.multistrike));
                const baseDmgPercent = 1.0;
                for (let n = 0; n < extra; n++) {
                    setTimeout(() => {
                        const fresh = useCombatStore.getState();
                        if (fresh.phase !== 'fighting' || !fresh.monster) return;
                        const wm = fresh.waveMonsters[fresh.activeTargetIdx];
                        if (!wm || wm.isDead) return;
                        const wRoll = Math.floor(rollWeaponDamage() * baseDmgPercent);
                        const followup = calculateDamage({
                            baseAtk: char.attack, weaponAtk: wRoll, skillBonus: classBonus.skillBonus,
                            classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                            enemyDefense: autoEffectiveDef,
                            critChance: (char.crit_chance ?? 0.05),
                            maxCritChance: maxCrit,
                            damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                        });
                        useCombatStore.getState().damageWaveMonster(fresh.activeTargetIdx, followup.finalDamage);
                        useCombatStore.getState().emitCombatEvent({
                            type: 'monsterHit',
                            data: { damage: followup.finalDamage, isCrit: followup.isCrit, isBlocked: false, hand: null, targetIdx: fresh.activeTargetIdx },
                            timestamp: Date.now(),
                        });
                        fresh.addLog(`:bow-and-arrow:×${n + 2} ${followup.finalDamage} dmg${followup.isCrit ? 'high-voltage' : ''}`, followup.isCrit ? 'crit' : 'player');
                    }, 120 * (n + 1));
                }
            }
            s.spendPlayerMp(autoMpCost);
            skillCooldownMap.set(skillId, now);
            useCooldownStore.getState().setSkillCooldown(skillId, SKILL_COOLDOWN_MS);
            if (sDef) applySkillBuff(skillId, sDef, speedMult);
            totalDamage += isDamageHit ? sr.finalDamage : 0;
            useSkillStore.getState().addMlvlXpFromSkill(char.class as any);
            // Stun / paralyze label payload so the view can pop a "STUN" /
            // "PARAL" status float on the targeted enemy slot. 2026-05 v6:
            // gated on the actual apply flags so failed `stun_chance:30:…`
            // rolls (Smite) don't push STUN every cast.
            const stunLabel = effApply?.paralyzeApplied
                ? 'PARAL'
                : effApply?.stunApplied
                    ? 'STUN'
                    : null;
            s.addLog(
                isDamageHit
                    ? `[AUTO] ${skillId}: ${sr.finalDamage} dmg${sr.isCrit ? ' :high-voltage:KRYTYK!' : ''} (-${autoMpCost} MP)`
                    : `[AUTO] ${skillId}: ${targetsEnemy ? 'DEBUFF' : 'BUFF'} (-${autoMpCost} MP)`,
                sr.isCrit ? 'crit' : 'player',
            );
            // Bundle damage + crit + classification into the skillAnim
            // payload. View routes the animation:
            //   - targetsEnemy -> enemy slot (damage hit OR enemy debuff)
            //   - !targetsEnemy -> player avatar (pure self/party buff)
            useCombatStore.getState().emitCombatEvent({
                type: 'skillAnim',
                data: {
                    skillId,
                    damage: isDamageHit ? sr.finalDamage : 0,
                    splashDamage: isDamageHit ? Math.max(1, Math.floor(sr.finalDamage * 0.75)) : 0,
                    isCrit: sr.isCrit,
                    targetIdx: useCombatStore.getState().activeTargetIdx,
                    aoeTargets: aoeTargetIdxs,
                    targetsEnemy,
                    stunLabel,
                    // 2026-05 v6: instant-kill marker — Skrytobójstwo /
                    // execute_below proc'd. View renders a "DEATH ATTACK"
                    // float on the targeted slot.
                    instantKill: !!effApply?.instantKill,
                    // instant_kill_chance success → finite execute burst on
                    // the primary target. View renders a DEATH ATTACK float
                    // showing this damage (0 when the roll failed).
                    executeBurstDmg: primaryExecuteBurstDmg,
                },
                timestamp: Date.now(),
            });
            break;
        }
    }

    // Auto-potion. `char` here is already the result of getEffectiveChar, so
    // its max_hp/max_mp already include eq + training + elixirs + transform.
    // Never pass it back into getEffectiveChar — that double-applies every
    // bonus and inflates maxVal enough to drop perceived 100% HP below the
    // auto-potion threshold, which was the "potion at 100% HP" bug.
    const freshAfterAtk = useCombatStore.getState();
    tryAutoPotion(
        freshAfterAtk.playerCurrentHp, char.max_hp,
        freshAfterAtk.playerCurrentMp, char.max_mp,
    );

    // Track damage for daily quests
    if (totalDamage > 0) useDailyQuestStore.getState().addProgress('deal_damage', totalDamage);

    // Check monster death (unless dual wield – 2nd hit checks separately)
    if (!isDualWield) {
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    } else {
        // For dual wield, check after first hit too
        const freshS = useCombatStore.getState();
        if (freshS.monsterCurrentHp <= 0 && freshS.phase === 'fighting') {
            handleMonsterDeath(freshS.monsterRarity);
        }
    }
};

// -- Monster attack tick -----------------------------------------------------

/**
 * Resolve a single wave-monster attack against its per-monster aggro target.
 * Each wave monster attacks independently, so 4 stacked monsters all strike
 * at once instead of waiting their turn in queue.
 * Returns `true` if the player died (so the outer caller can stop iterating).
 */
const doSingleWaveMonsterAttack = (waveIdx: number): boolean => {
    const s = useCombatStore.getState();
    const wm = s.waveMonsters[waveIdx];
    if (!wm || wm.isDead) return false;
    const monster = wm.monster;
    const char = getEffectiveChar(useCharacterStore.getState().character);
    if (!char) return false;

    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const shieldingLevel = skillLevels['shielding'] ?? 0;
    const isPhysical = !monster.magical;

    // Per-monster aggro — independent class-weighted roll per wave monster.
    // The roll pool is widened when we're the LEADER of a multi-human
    // party: bots + party humans both become valid targets. Solo / no
    // bots simply targets the player.
    const partyStateForAggro = usePartyStore.getState().party;
    const hasBots = useBotStore.getState().bots.some((b) => b.alive);
    const iAmLeader = !!(
        partyStateForAggro && char.id &&
        partyStateForAggro.leaderId === char.id &&
        partyStateForAggro.members.some((m) => !m.isBot && m.id !== char.id)
    );
    const widenPool = hasBots || iAmLeader;
    const targetId = widenPool ? maybeSwitchWaveAggro(waveIdx) : 'player';
    // Mirror the current aggro target into the wave state so the UI can show it
    useCombatStore.getState().setWaveMonsterAggro(waveIdx, targetId);

    // 2026-05-11 spec ("kogo potwor uderzyl"): aggro target is a remote
    // party human -> leader resolves damage on their end and broadcasts
    // a `member-hit` to that specific member. The member applies it
    // to their own character.hp (and emits a playerHit-style event so
    // their TopHeader / ally card flashes). All other clients see the
    // updated aggroTarget via the state broadcast -> red border on the
    // targeted member's card.
    if (typeof targetId === 'string' && targetId.startsWith('human_')) {
        const memberId = targetId.slice('human_'.length);
        const rolledAtkM = rollMonsterDamage(monster);
        // We don't know the member's exact defense — use a conservative
        // baseline (~75% of leader's defense). This is a temporary
        // approximation until each member broadcasts their defense in
        // presence; for now it keeps fights roughly fair.
        const approxMemberDef = Math.floor(char.defense * 0.75);
        const dmgM = Math.max(1, rolledAtkM - approxMemberDef);
        useCombatStore.getState().addLog(
            `${monster.name_pl} atakuje sojusznika za ${dmgM} dmg`,
            'monster',
        );
        // Broadcast — targeted member applies the damage, every client
        // (including the leader who doesn't get their own broadcast)
        // renders an incoming-damage float on the targeted ally card.
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishMemberHit({
                memberId,
                damage: dmgM,
                sourceMonsterIdx: waveIdx,
            });
        }).catch(() => { /* offline */ });
        // Self-mirror: the leader doesn't receive their own member-hit
        // broadcast (channel config `self: false`). Inject the same
        // value into the local sync-store state so the leader's
        // Combat.tsx watcher fires the float on their UI too.
        import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            // The store's internal `set` is exposed via setState; we
            // mutate `lastMemberHit` directly so the existing watcher
            // path is unified across clients.
            usePartyCombatSyncStore.setState({
                lastMemberHit: {
                    memberId,
                    damage: dmgM,
                    sourceMonsterIdx: waveIdx,
                    sentAt: Date.now(),
                },
            });
        }).catch(() => { /* offline */ });
        return false;
    }

    if (targetId !== 'player') {
        // Monster attacks a bot. Bots have no block/dodge/elixirs — simple
        // damage calc using their raw defense.
        const bot = useBotStore.getState().bots.find((b) => b.id === targetId);
        if (!bot || !bot.alive) {
            // Fallback: target invalid, clear this monster's aggro state so it re-rolls.
            waveAggroState.delete(waveIdx);
            return false;
        }
        // 2026-05 v6: bot defBuffPct (Knight Umocnienie / Żelazna Obrona
        // via party_defense_up) bumps bot defense for the buff window.
        // immortal also zeros incoming damage entirely.
        const botStatus = huntEffects.statuses.get(bot.id);
        if (botStatus && botStatus.immortalMs > 0) {
            return false; // Immortal bot eats nothing.
        }
        const botDefMult = (botStatus && botStatus.defBuffMs > 0 && botStatus.defBuffPct > 0)
            ? 1 + (botStatus.defBuffPct / 100) : 1;
        const effBotDef = Math.floor(bot.defense * botDefMult);
        const rolledAtkBot = rollMonsterDamage(monster);
        const dmg = Math.max(1, rolledAtkBot - effBotDef);
        const newHp = Math.max(0, bot.hp - dmg);
        useBotStore.getState().updateBotHp(bot.id, newHp);

        // Per-bot hit event so the UI can re-trigger that bot's flash overlay.
        // Without this, only the player flashed when monsters hit anyone, so
        // the player couldn't visually tell which ally was being focused.
        useCombatStore.getState().emitCombatEvent({
            type: 'botHit',
            data: { botId: bot.id, damage: dmg, attackerWaveIdx: waveIdx },
            timestamp: Date.now(),
        });

        // Shortcode form (`:robot::class:`) so <EmojiText> in the log renderer
        // turns it into icons — a bare name would print as literal text.
        const botIcon = `:robot::${BOT_CLASS_ICONS_LOCAL[bot.class] ?? 'robot'}:`;
        s.addLog(`${monster.name_pl} atakuje ${botIcon} ${bot.name} za ${dmg} dmg`, 'monster');

        if (newHp <= 0) {
            s.addLog(`:skull: ${botIcon} ${bot.name} ginie w walce!`, 'system');
            // Force immediate per-monster aggro re-roll so next tick picks a new target
            waveAggroState.delete(waveIdx);
        }
        return false;
    }

    // Target is the player.
    // 2026-05 v6: Krok Cienia / Unik (`dodge_next:N:non_magic`) — charge
    // buff in BuffStore. Each enemy basic hit consumes one charge and
    // skips the swing entirely. Hunt-mode wave monsters are physical
    // attackers (non-magical) so the non_magic scope always matches.
    if (useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
        s.addLog(`${monster.name_pl} atakuje – Krok Cienia! Unik!`, 'dodge');
        useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
        return false;
    }
    // 2026-05 v6: Cleric Boska Tarcza — block_next_party charge buff.
    // Stacks up to 2 across casts; each enemy basic hit consumes one
    // charge and eats the full hit. Player sees a BLOCK float on their
    // slot (handled in Combat.tsx via the playerHit event with
    // isImmortal:true — same render path as Knight Absolutne Cięcie).
    if (useBuffStore.getState().getBuffCharges('skill_charge_block_next_party') > 0) {
        useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
        s.addLog(`:shield: Boska Tarcza! Blok ${monster.name_pl}!`, 'system');
        useCombatStore.getState().emitCombatEvent({
            type: 'playerHit',
            data: { damage: 0, isCrit: false, isBlocked: false, hpDamage: 0, mpDamage: 0, isImmortal: true },
            timestamp: Date.now(),
        });
        return false;
    }
    // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000) — N% chance
    // to dodge each incoming basic during the buff window. Was wired
    // in skillEffectsV2.resolveBasicHit (Arena only); Hunt/Boss/etc.
    // never read it. Roll on incoming hit; success -> no damage +
    // playerDodge event so the view can flash an UNIK float.
    const huntPlayerStatus = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    if (huntPlayerStatus.dodgeBuffMs > 0 && huntPlayerStatus.dodgeBuffPct > 0) {
        if (Math.random() * 100 < huntPlayerStatus.dodgeBuffPct) {
            s.addLog(`:dashing-away: Bomba Dymna! Unikasz ataku ${monster.name_pl} (${huntPlayerStatus.dodgeBuffPct}%)`, 'dodge');
            useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
            return false;
        }
    }
    const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
    const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skillLevels['agility'] ?? 0, isPhysical) : 0;

    // 2026-05 v6: defBuffPct (Knight Umocnienie / Żelazna Obrona via
    // party_defense_up) bumps the player's effective defense for the
    // duration of the buff. Engine writes p.defBuffPct on cast but
    // never read it on incoming damage — fixed here.
    const playerStatusForDef = ensureStatus(huntEffects, HUNT_PLAYER_FX_ID);
    const defBuffMult = (playerStatusForDef.defBuffMs > 0 && playerStatusForDef.defBuffPct > 0)
        ? 1 + (playerStatusForDef.defBuffPct / 100) : 1;
    const effectivePlayerDef = Math.floor(char.defense * defBuffMult);

    const rolledAtk = rollMonsterDamage(monster);
    const r = calculateDamage({
        baseAtk: rolledAtk, weaponAtk: 0, skillBonus: 0,
        classModifier: 1.0,
        enemyDefense: effectivePlayerDef,
        blockChance,
        dodgeChance,
    });

    if (r.isDodged) {
        s.addLog(`${monster.name_pl} atakuje – unikasz ataku!`, 'dodge');
        useCombatStore.getState().emitCombatEvent({ type: 'playerDodge', timestamp: Date.now() });
        return false;
    }

    // 2026-05 v6: immortal — Knight Absolutne Cięcie sets player.immortalMs.
    // Engine wrote it but never read it on incoming damage. Now we zero
    // the hit when immortal is active, push a BLOCK float on the player
    // slot, log it, return.
    if (playerStatusForDef.immortalMs > 0) {
        s.addLog(`${monster.name_pl} atakuje – BLOCK! Niewrażliwość!`, 'block');
        useCombatStore.getState().emitCombatEvent({
            type: 'playerHit',
            data: { damage: 0, isCrit: false, isBlocked: false, hpDamage: 0, mpDamage: 0, isImmortal: true },
            timestamp: Date.now(),
        });
        return false;
    }

    // 2026-05 v6: Mage Tarcza Many — drains 100% incoming dmg to MP
    // first, HP overflows only when MP runs out. Self-buff, so checked
    // on the player's own status. Stronger than Utamo Vita (50%); both
    // can stack — Tarcza Many runs first (full redirect), then Utamo
    // Vita splits whatever HP damage remains.
    let hpDamage = r.finalDamage;
    let mpDamage = 0;
    const manaShieldSplit = applyManaShieldRedirect(playerStatusForDef, s.playerCurrentMp, r.finalDamage);
    if (manaShieldSplit.shieldActive) {
        mpDamage += manaShieldSplit.mpDmg;
        hpDamage = manaShieldSplit.hpDmg;
        if (manaShieldSplit.mpDmg > 0) {
            s.spendPlayerMp(manaShieldSplit.mpDmg);
            s.addLog(`:shield: Tarcza Many pochłania ${manaShieldSplit.mpDmg} MP`, 'block');
            // 2026-05 v6: emit a dedicated event so the view pushes a
            // blue MP-loss float on the player slot (so the player can
            // SEE the shield eating the swing).
            useCombatStore.getState().emitCombatEvent({
                type: 'playerHit',
                data: { damage: 0, mpDamage: manaShieldSplit.mpDmg, hpDamage: 0, isCrit: false, isBlocked: false, isManaShield: true },
                timestamp: Date.now(),
            });
        }
    }
    // Utamo Vita (Magic Shield): 50% dmg -> MP (operates on whatever's
    // left after Tarcza Many, so the two stack instead of conflicting).
    const hasUtamo = useBuffStore.getState().hasBuff('utamo_vita');
    if (hasUtamo && s.playerCurrentMp > 0 && hpDamage > 0) {
        const utamoMp = Math.floor(hpDamage * 0.5);
        let actualMp = utamoMp;
        let leftover = 0;
        if (actualMp > s.playerCurrentMp) {
            leftover = actualMp - s.playerCurrentMp;
            actualMp = s.playerCurrentMp;
        }
        mpDamage += actualMp;
        hpDamage = hpDamage - utamoMp + leftover;
        s.spendPlayerMp(actualMp);
        if (s.playerCurrentMp - actualMp <= 0) {
            useBuffStore.getState().removeBuffByEffect('utamo_vita');
            s.addLog(':blue-circle: Utamo Vita peka! Brak many.', 'system');
        }
    }

    // Necromancer summon shield — front-of-queue summon eats single-target
    // hits before the necro takes them. AOE hits would call `damageAll`
    // separately (no AOE in basic monster swings here, only boss-AOE in Boss
    // view). Once the queue is empty, the necro takes the rest normally.
    if (char.class === 'Necromancer' && hpDamage > 0) {
        const store = useNecroSummonStore.getState();
        if (store.count(HUNT_PLAYER_FX_ID) > 0) {
            const r2 = store.damageFirst(HUNT_PLAYER_FX_ID, hpDamage);
            hpDamage = Math.max(0, hpDamage - r2.dmgConsumed);
        }
    }

    // Re-read playerCurrentHp in case an earlier monster in this tick already hit.
    const live = useCombatStore.getState();
    const newPHp = Math.max(0, live.playerCurrentHp - hpDamage);
    if (hpDamage > 0) useCombatStore.getState().dealToPlayer(hpDamage);

    if (r.isBlocked) {
        s.addLog(`${monster.name_pl} atakuje za ${r.finalDamage} dmg :shield: ZABLOKOWANE! (${r.damage} -> ${r.finalDamage})`, 'block');
        useSkillStore.getState().addShieldingXpOnBlock();
    } else {
        const utamoSuffix = hasUtamo && mpDamage > 0 ? ` :blue-circle: (${hpDamage} HP / ${mpDamage} MP)` : '';
        let text = `${monster.name_pl} atakuje cię za ${r.finalDamage} dmg`;
        if (r.isCrit) text += ' :high-voltage:KRYTYK!';
        if (utamoSuffix) text += utamoSuffix;
        s.addLog(text, r.isCrit ? 'crit' : 'monster');
    }

    useCombatStore.getState().emitCombatEvent({
        type: 'playerHit',
        data: { damage: r.finalDamage, isCrit: r.isCrit, isBlocked: r.isBlocked, hpDamage, mpDamage },
        timestamp: Date.now(),
    });

    // 2026-05-11 spec ("na ekranie knighta nie widze jak archer dostaje
    // obrazenia"): when the leader takes a hit in a multi-human party,
    // broadcast a member-hit so the other clients render the floating
    // damage on the leader's ally card. The targeted-self guard in
    // usePartyCombatSync makes sure the leader's own client doesn't
    // RE-apply the damage on receipt (it skips by id), so this is
    // purely visual for non-leader members.
    {
        const liveChForBroadcast = useCharacterStore.getState().character;
        const ps = usePartyStore.getState().party;
        const oh = ps?.members.filter((m) => m.id !== liveChForBroadcast?.id && !m.isBot) ?? [];
        const isLeaderInParty = !!(
            ps && liveChForBroadcast && oh.length > 0 && ps.leaderId === liveChForBroadcast.id
        );
        if (isLeaderInParty && hpDamage > 0) {
            import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                usePartyCombatSyncStore.getState().publishMemberHit({
                    memberId: liveChForBroadcast!.id,
                    damage: hpDamage,
                    sourceMonsterIdx: waveIdx,
                });
            }).catch(() => { /* offline */ });
        }
    }

    // Auto-potion after damage. `char` here is already effective — passing it
    // through getEffectiveChar again would double-apply bonuses and break the
    // threshold math (see doPlayerAttackTick comment above).
    if (newPHp > 0) {
        tryAutoPotion(
            newPHp, char.max_hp,
            useCombatStore.getState().playerCurrentMp, char.max_mp,
        );
    }

    if (newPHp <= 0) {
        handlePlayerDeath();
        return true;
    }
    return false;
};

export const doMonsterAttackTick = (): void => {
    const s = useCombatStore.getState();
    if (s.phase !== 'fighting' || !s.monster) return;

    // Parallel wave attacks: every alive wave monster takes its turn at once.
    // Each monster uses independent aggro. If any attack kills the player,
    // stop iterating so the death handler owns the transition.
    const aliveIdxs: number[] = [];
    for (let i = 0; i < s.waveMonsters.length; i++) {
        if (!s.waveMonsters[i].isDead) aliveIdxs.push(i);
    }
    if (aliveIdxs.length === 0) return;

    for (const idx of aliveIdxs) {
        // Re-check phase between attacks in case a previous one caused death
        if (useCombatStore.getState().phase !== 'fighting') return;
        // Per-monster stun gate — a paralysed mob skips its swing this tick.
        const wm = useCombatStore.getState().waveMonsters[idx];
        if (wm && isHuntMonsterStunned(idx, wm.monster.id)) continue;
        const died = doSingleWaveMonsterAttack(idx);
        if (died) return;
    }
};

// -- Bot attack tick ---------------------------------------------------------
// Runs on a separate interval in useBackgroundCombat. All alive bots attack
// the active wave target together. Simpler than per-bot intervals and still
// visually readable: bots fire roughly as often as the player does.

export const doBotAttackTick = (): void => {
    const s = useCombatStore.getState();
    if (s.phase !== 'fighting' || !s.monster) return;

    const bots = useBotStore.getState().bots.filter((b) => b.alive);
    if (bots.length === 0) return;

    for (const bot of bots) {
        const live = useCombatStore.getState();
        if (live.phase !== 'fighting' || !live.monster) return;

        // 2026-05 v6: read this bot's v2 status so party_attack_up /
        // party_crit_up actually scales bot damage. Bots are entered into
        // allyIds during cast -> engine writes atkBuffPct/partyCritPct to
        // their per-bot status — now we honor those numbers here.
        const botStatus = huntEffects.statuses.get(bot.id);
        const botAtkBuffMult = (botStatus && botStatus.atkBuffMs > 0 && botStatus.atkBuffPct > 0)
            ? 1 + (botStatus.atkBuffPct / 100) : 1;
        const botPartyCritBonus = (botStatus && botStatus.partyCritMs > 0 && botStatus.partyCritPct > 0)
            ? botStatus.partyCritPct : 0;

        // Base damage: (bot.attack × buff) - monster defense, with ±20% variance
        const buffedAtk = Math.floor(bot.attack * botAtkBuffMult);
        const baseDmg = Math.max(1, buffedAtk - live.monster.defense);
        const variance = Math.floor(baseDmg * 0.2);
        const finalDmg = Math.max(1, baseDmg - variance + Math.floor(Math.random() * (variance * 2 + 1)));

        // Crit roll (party_crit_up adds % chance for the buff window)
        const isCrit = Math.random() * 100 < (bot.critChance + botPartyCritBonus);
        let dealt = isCrit ? Math.floor(finalDmg * 1.8) : finalDmg;

        // 2026-05 v7: bot attacks consume Klątwa Śmierci (count) AND
        // benefit from Kraina Śmierci (duration ×N) the same as the
        // player's own swings.
        const ampBot = consumeHuntMonsterMarkAmp(live.activeTargetIdx, live.monster.id);
        if (ampBot.mult !== 1) {
            dealt = Math.max(1, Math.floor(dealt * ampBot.mult));
        }

        live.dealToMonster(dealt);

        // Shortcode form (`:robot::class:`) so <EmojiText> in the log renderer
        // turns it into icons — a bare name would print as literal text.
        const botIcon = `:robot::${BOT_CLASS_ICONS_LOCAL[bot.class] ?? 'robot'}:`;
        const critSuffix = isCrit ? ' :high-voltage:KRYTYK!' : '';
        live.addLog(
            `${botIcon} ${bot.name} atakuje ${live.monster.name_pl} za ${dealt} dmg${critSuffix}`,
            isCrit ? 'crit' : 'player',
        );

        // Per-monster ally-attack event so the combat view can:
        //  - flash the monster card (re-uses the same `monsterHit` style),
        //  - push an ally-basic floating damage number on it (cyan, vs. the
        //    player's white) so the player can see *which* attacker hit
        //    *which* monster and *for how much* — including ally crits.
        useCombatStore.getState().emitCombatEvent({
            type: 'botMonsterHit',
            data: { damage: dealt, isCrit, targetIdx: live.activeTargetIdx, botId: bot.id, attackerClass: bot.class },
            timestamp: Date.now(),
        });

        // Check monster death after this bot's hit — handle wave/victory
        const afterHit = useCombatStore.getState();
        if (afterHit.monsterCurrentHp <= 0 && afterHit.phase === 'fighting') {
            handleMonsterDeath(afterHit.monsterRarity);
            // If handleMonsterDeath advanced to next wave target, continue
            // with the remaining bots against the new monster. If it set
            // phase to 'victory' (no more alive monsters), the outer guard
            // above will break out of the loop on the next iteration.
        }
    }
};

// Local copy of class icons (mirrors botSystem BOT_CLASS_ICONS) — kept here
// to avoid a circular import at module load time.
const BOT_CLASS_ICONS_LOCAL: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles',
    Archer: 'bow-and-arrow', Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

// -- SKIP mode: instant resolution -------------------------------------------

export const resolveInstantFight = (m: IMonster, startHp: number, startMp: number, rarity: TMonsterRarity): void => {
    // Gear-gap penalty: SKIP resolution must scale the player's attack the same
    // way the live tick does, so under-geared SKIP wins are gated identically.
    const char = getEffectiveChar(useCharacterStore.getState().character, m.level ?? 0);
    if (!char) return;

    const classConfig = getClassConfig(char.class);
    const playerMs = getAttackMs(char.attack_speed || 1);
    const monsterMs = getAttackMs(m.speed || 1);
    const skipSkillLevels = useSkillStore.getState().skillLevels;
    const skipClassBonus = getClassSkillBonus(char.class, skipSkillLevels);
    const shieldingLevel = skipSkillLevels['shielding'] ?? 0;

    let mHp = m.hp;
    let pHp = Math.max(1, startHp);
    let nextPlayer = 0;
    let nextMonster = monsterMs;
    let skipTotalDamageDealt = 0;

    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

    for (let iter = 0; iter < 5000 && mHp > 0 && pHp > 0; iter++) {
        if (nextPlayer <= nextMonster) {
            if (classConfig.dualWield) {
                const dw = calculateDualWieldDamage({
                    baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                    offHandAtk: rollOffHandDamage(),
                    skillBonus: skipClassBonus.skillBonus,
                    classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                    enemyDefense: m.defense,
                    critChance: (char.crit_chance ?? 0.05) + skipClassBonus.extraCritChance,
                    maxCritChance: maxCrit,
                    damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                });
                mHp = Math.max(0, mHp - dw.totalDamage);
                skipTotalDamageDealt += dw.totalDamage;
            } else {
                const r = calculateDamage({
                    baseAtk: char.attack, weaponAtk: rollWeaponDamage(),
                    skillBonus: skipClassBonus.skillBonus,
                    classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                    enemyDefense: m.defense,
                    critChance: (char.crit_chance ?? 0.05) + skipClassBonus.extraCritChance,
                    maxCritChance: maxCrit,
                    damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                });
                mHp = Math.max(0, mHp - r.finalDamage);
                skipTotalDamageDealt += r.finalDamage;
            }
            nextPlayer += playerMs;
        } else {
            const isPhysical = !m.magical;
            const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
            const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skipSkillLevels['agility'] ?? 0, isPhysical) : 0;
            const r = calculateDamage({
                baseAtk: rollMonsterDamage(m), weaponAtk: 0, skillBonus: 0,
                classModifier: 1.0, enemyDefense: char.defense,
                blockChance, dodgeChance,
            });
            pHp = Math.max(0, pHp - r.finalDamage);
            nextMonster += monsterMs;
        }
    }

    useCombatStore.getState().setHps(mHp, pHp);

    if (skipTotalDamageDealt > 0) {
        useDailyQuestStore.getState().addProgress('deal_damage', skipTotalDamageDealt);
    }

    if (mHp <= 0) {
        const gold = 0;
        useCombatStore.getState().setLastDrops([]);
        const skipBStore = useBuffStore.getState();
        // 2026-05-08: same stacking rule as live combat — 100% first.
        const skipHas100 = skipBStore.hasBuff('xp_boost_100');
        const skipHas50 = skipBStore.hasBuff('xp_boost');
        const skipXpMult = skipHas100
          ? skipBStore.getBuffMultiplier('xp_boost_100')
          : skipHas50 ? skipBStore.getBuffMultiplier('xp_boost') : 1;
        const skipPremiumMult = skipBStore.getBuffMultiplier('premium_xp_boost');
        const skipMasteryLevel = useMasteryStore.getState().getMasteryLevel(m.id);
        const skipMasteryXpMult = getMasteryXpMultiplier(skipMasteryLevel);
        const skipFinalXp = Math.floor(m.xp * skipXpMult * skipPremiumMult * skipMasteryXpMult * 0.75);
        if (skipBStore.hasBuff('premium_xp_boost')) skipBStore.consumePausableTime('premium_xp_boost', 2000);
        if (skipHas100) skipBStore.consumePausableTime('xp_boost_100', 2000);
        else if (skipHas50) skipBStore.consumePausableTime('xp_boost', 2000);
        if (skipBStore.hasBuff('skill_xp_boost_100')) skipBStore.consumePausableTime('skill_xp_boost_100', 2000);
        else if (skipBStore.hasBuff('skill_xp_boost')) skipBStore.consumePausableTime('skill_xp_boost', 2000);
        tickCombatElixirs(2000);
        useCombatStore.getState().addReward(skipFinalXp, gold);
        const xpResult = useCharacterStore.getState().addXp(skipFinalXp);
        if (xpResult.levelsGained > 0) {
            useCombatStore.getState().addLog(`Awans! Poziom ${xpResult.newLevel}! (+${xpResult.statPointsGained} pkt statystyk) – pełne HP/MP!`, 'system');
        }
        // On level-up: addXp already full-healed character.hp/mp — don't overwrite.
        // Otherwise persist this fight's final HP/MP, clamped to effective max.
        if (xpResult.levelsGained === 0) {
            const skipEffChar = getEffectiveChar(useCharacterStore.getState().character);
            const skipMaxHp = skipEffChar?.max_hp ?? pHp;
            const skipMaxMp = skipEffChar?.max_mp ?? startMp;
            useCharacterStore.getState().updateCharacter({
                hp: Math.min(skipMaxHp, pHp),
                mp: Math.min(skipMaxMp, startMp),
            });
        } else {
            // Sync combat store to the freshly-healed character
            const healed = useCharacterStore.getState().character;
            if (healed) {
                useCombatStore.getState().setHps(mHp, healed.hp);
                useCombatStore.setState({ playerCurrentMp: healed.mp });
            }
        }
        void saveCurrentCharacterStores();
        const skipTaskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
        useTaskStore.getState().addKill(m.id, m.level, skipTaskKills);
        useQuestStore.getState().addProgress('kill', m.id, skipTaskKills);
        useQuestStore.getState().addProgress('kill_rarity', rarity, 1, m.level);
        useDailyQuestStore.getState().addProgress('kill_any', 1);
        useMasteryStore.getState().addMasteryKills(m.id, skipTaskKills);
        useCombatStore.getState().addSessionStats(skipFinalXp, 0);
        useCombatStore.getState().incrementSessionKill(rarity);
        useCombatStore.getState().setPhase('victory');
    } else {
        handlePlayerDeath();
        useCombatStore.getState().setLastDrops([]);
    }
};

// -- Start new fight ---------------------------------------------------------

export const startNewFight = (baseMonster: IMonster, bypassLevelCheck = false): void => {
    // Fresh effect session — clears any leftover DOT/stun/marks from
    // the previous wave so a new fight starts clean.
    resetHuntEffects();
    const char = useCharacterStore.getState().character;
    if (!char) return;
    // Block while offline hunt is running — mutual exclusion.
    if (useOfflineHuntStore.getState().isActive) {
        useCombatStore.getState().addLog(':prohibited: Nie mozesz walczyc podczas Offline Hunt. Odbierz lub zakoncz polowanie.', 'system');
        return;
    }
    if (!bypassLevelCheck && baseMonster.level > char.level) {
        useCombatStore.getState().addLog(`${baseMonster.name_pl} jest zbyt silny! (wymaga lvl ${baseMonster.level})`, 'system');
        return;
    }
    // 2026-05-11 spec ("knight nie dolaczyl do walki mimo ze zaakceptowal"):
    // when called with `bypassLevelCheck=true` (party-member follow path
    // — leader has already validated the encounter on their end), also
    // skip the mastery gate. A level-961 member following a level-1000
    // leader into a level-1000 monster otherwise bailed here with a
    // silent log line and the fight never started on his screen.
    if (!bypassLevelCheck) {
        const masteriesState = useMasteryStore.getState().masteries;
        const unlock = getMonsterUnlockStatus(baseMonster, monsters, char.level, masteriesState);
        if (!unlock.unlocked && unlock.lockKind === 'mastery') {
            useCombatStore.getState().addLog(`:locked: ${unlock.reason}`, 'system');
            return;
        }
    }

    const speed = useSettingsStore.getState().combatSpeed;
    const isSkip = speed === 'SKIP';
    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
    const rarity = rollMonsterRarity(isSkip, masteryBonuses);
    const scaledMonster = applyRarityToMonster(baseMonster, rarity);

    useCombatStore.getState().setLastDrops([]);
    useCombatStore.getState().setBaseMonster(baseMonster);
    // Clamp starting HP/MP to effective max to prevent HP > maxHP
    // (can happen if buffs/elixirs expired since last heal).
    // Don't auto-refill to effMax just because char.hp >= raw max_hp — after a
    // victory char.hp can already exceed raw max_hp (it tracks the elixir-
    // inflated value), and treating that as "full" would re-heal the player
    // to 100% on the next fight even though they took damage.
    const effCharForInit = getEffectiveChar(char);
    const effMaxHpInit = effCharForInit?.max_hp ?? char.max_hp;
    const effMaxMpInit = effCharForInit?.max_mp ?? char.max_mp;
    const clampedHp = Math.min(char.hp, effMaxHpInit);
    const clampedMp = Math.min(char.mp, effMaxMpInit);
    useCombatStore.getState().initCombat(scaledMonster, clampedHp, clampedMp, rarity);

    // Hydrate party bots into botStore so they fight alongside the player.
    // Only runs if player has a party with bot members and botStore is empty
    // (idempotent across auto-fight iterations).
    hydrateBotsFromParty();
    // Fresh aggro roll for the new fight
    resetAggro();

    // Log rarity info
    if (rarity !== 'normal') {
        useCombatStore.getState().addLog(`:warning: ${MONSTER_RARITY_LABELS[rarity]} ${baseMonster.name_pl} (Poziom ${baseMonster.level}) – wzmocniony potwór!`, 'system');
    } else {
        useCombatStore.getState().addLog(`Walka z ${baseMonster.name_pl} (Poziom ${baseMonster.level}) rozpoczęta!`, 'system');
    }

    // Sticky wave size — spawn remaining planned monsters (each gets its own rarity roll)
    const plannedCount = useCombatStore.getState().wavePlannedCount;
    if (plannedCount > 1 && !isSkip) {
        for (let i = 1; i < plannedCount; i++) {
            const extraRarity = rollMonsterRarity(false, masteryBonuses);
            const extraScaled = applyRarityToMonster(baseMonster, extraRarity);
            useCombatStore.getState().addWaveMonster(extraScaled, extraRarity);
        }
        useCombatStore.getState().addLog(`:paw-prints: Fala ${plannedCount} potworów!`, 'system');
    }

    // Auto-potion at fight start.
    // Read live HP/MP from combatStore (post-initCombat) instead of char.hp/char.mp
    // so we compare against the same effMax the UI shows — char.hp is pre-clamp
    // and can be out of sync with playerCurrentHp/effMax, causing auto-potion to
    // fire at what the user perceives as 100%.
    if (!isSkip) {
        const effChar = getEffectiveChar(char);
        const effMaxHp = effChar?.max_hp ?? char.max_hp;
        const effMaxMp = effChar?.max_mp ?? char.max_mp;
        const liveCs = useCombatStore.getState();
        tryAutoPotion(liveCs.playerCurrentHp, effMaxHp, liveCs.playerCurrentMp, effMaxMp);
    }

    // Set background started timestamp if not already set
    if (!useCombatStore.getState().backgroundStartedAt) {
        useCombatStore.getState().setBackgroundStartedAt(new Date().toISOString());
    }

    if (isSkip) {
        // SKIP mode respects the sticky wave size — simulate `plannedCount`
        // sequential kills. Each iteration rolls a fresh monster + rarity
        // (matching the live-combat behavior where each wave slot rolls).
        const skipCount = Math.max(1, plannedCount);
        for (let i = 0; i < skipCount; i++) {
            // Re-read live HP/MP so consecutive fights start where the
            // previous one ended (death breaks the loop).
            const liveChar = useCharacterStore.getState().character;
            if (!liveChar) return;
            if (useCombatStore.getState().phase === 'dead') return;
            // Auto-potion between SKIP iterations using live HP/MP, clamped
            // to effective max so an expired elixir can't leave HP > max.
            const effChar = getEffectiveChar(liveChar);
            const effMaxHp = effChar?.max_hp ?? liveChar.max_hp;
            const effMaxMp = effChar?.max_mp ?? liveChar.max_mp;
            const curHp = Math.min(liveChar.hp, effMaxHp);
            const curMp = Math.min(liveChar.mp, effMaxMp);
            tryAutoPotion(curHp, effMaxHp, curMp, effMaxMp);
            const postPotionChar = useCharacterStore.getState().character;
            if (!postPotionChar) return;
            let iterMonster = scaledMonster;
            let iterRarity = rarity;
            if (i > 0) {
                iterRarity = rollMonsterRarity(true, masteryBonuses);
                iterMonster = applyRarityToMonster(baseMonster, iterRarity);
                useCombatStore.getState().initCombat(iterMonster, postPotionChar.hp, postPotionChar.mp, iterRarity);
            }
            resolveInstantFight(iterMonster, postPotionChar.hp, postPotionChar.mp, iterRarity);
            if (useCombatStore.getState().phase === 'dead') return;
        }
    }
};

/**
 * Add another monster of the same base type to the active wave.
 * Only works during `phase === 'fighting'` and when wave < 4.
 * Rolls a fresh rarity for the new monster.
 *
 * Also bumps `wavePlannedCount` so the bigger wave size sticks across
 * subsequent auto-fights — the player doesn't have to re-click after
 * every victory.
 */
export const addMonsterToWave = (): boolean => {
    const cs = useCombatStore.getState();
    if (cs.phase !== 'fighting') return false;
    if (cs.waveMonsters.length >= 4) return false;
    const base = cs.baseMonster;
    if (!base) return false;

    const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(base.id);
    // Force non-skip rarity roll
    const rarity = rollMonsterRarity(false, masteryBonuses);
    const scaled = applyRarityToMonster(base, rarity);

    const added = useCombatStore.getState().addWaveMonster(scaled, rarity);
    if (!added) return false;

    // Make the bigger wave sticky for subsequent auto-fights.
    useCombatStore.getState().incrementWavePlannedCount();

    const label = rarity !== 'normal' ? `${MONSTER_RARITY_LABELS[rarity]} ` : '';
    useCombatStore.getState().addLog(
        `:plus: Pojawia się kolejny ${label}${base.name_pl}! (${useCombatStore.getState().waveMonsters.length}/4) — kolejne fale będą tej samej wielkości`,
        'system',
    );
    return true;
};

/**
 * Auto-next fight: called after victory + delay.
 * Uses the baseMonster stored in combatStore.
 */
export const startAutoNextFight = (): void => {
    const { baseMonster, autoFight } = useCombatStore.getState();
    if (!autoFight || !baseMonster) return;
    // Run auto-potion between fights
    const char = useCharacterStore.getState().character;
    if (char) {
        const effChar = getEffectiveChar(char);
        const s = useCombatStore.getState();
        tryAutoPotion(
            s.playerCurrentHp, effChar?.max_hp ?? char.max_hp,
            s.playerCurrentMp, effChar?.max_mp ?? char.max_mp,
        );
    }
    startNewFight(baseMonster, true);
};

/**
 * Stop combat: sync HP/MP to characterStore and reset combat.
 */
export const stopCombat = (): void => {
    const cs = useCombatStore.getState();
    // 2026-05-11 spec ("po wyjsciu knight ma 0hp i 0mp"): for non-leader
    // members in a multi-human party, combatStore.playerCurrentHp tracks
    // the SHARED arena state pushed from the leader's broadcast — it has
    // nothing to do with the member's own character HP. Writing it back
    // to character.hp here would nuke a healthy member to 0. Members'
    // character HP is owned by character store directly and survives
    // exit unchanged.
    const partyState = usePartyStore.getState().party;
    const ch = useCharacterStore.getState().character;
    const otherHumans = partyState?.members.filter((m) => m.id !== ch?.id && !m.isBot) ?? [];
    const isMemberInPartyCombat = !!(
        ch && partyState && otherHumans.length > 0 && partyState.leaderId !== ch.id
    );
    if ((cs.phase === 'fighting' || cs.phase === 'victory') && !isMemberInPartyCombat) {
        useCharacterStore.getState().updateCharacter({
            hp: cs.playerCurrentHp,
            mp: cs.playerCurrentMp,
        });
    }
    if (isMemberInPartyCombat) {
        // Arm the death-grace window so any delayed `handlePlayerDeath`
        // call (from queued ticks, broadcasts arriving after we've
        // already returned to /battle, etc.) is silently dropped for
        // PARTY_EXIT_GRACE_MS — even after `leaveParty()` clears
        // `party=null` and the synchronous gate misses.
        markPartyExitGrace();
        // Pre-emptive heal: member's character.hp may have been drained
        // by accumulated `member-hit` broadcasts during the fight. We
        // don't want them showing 0 HP on the next view OR being
        // misinterpreted by some other code as "dead". Restore here.
        if (ch && (ch.hp ?? 0) <= 0) {
            useCharacterStore.getState().fullHealEffective();
        }
    }
    // 2026-05-12 spec ("lider konczy polowanie -> sojusznicy wracaja do
    // miasta"): if WE are the leader of a multi-human party, broadcast
    // a combat-end signal so every member receives it via the
    // party-combat channel and navigates back to town. Members'
    // local stopCombat is not synchronized with the leader's — without
    // this broadcast they'd stay on /combat with stale state.
    const iAmLeaderInPartyCombat = !!(
        ch && partyState && otherHumans.length > 0 && partyState.leaderId === ch.id
    );
    if (iAmLeaderInPartyCombat) {
        // Fire-and-forget — lazy import avoids the circular dep
        // (partyCombatSyncStore imports types from this file).
        void import('../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishCombatEnd();
        }).catch(() => { /* offline */ });
    }
    cs.resetCombat();
    // Release the bot companions — they re-hydrate on the next startNewFight
    // via hydrateBotsFromParty if the player still has a party.
    useBotStore.getState().clearBots();
    // Necro summons are session-bound — exiting combat drops them all.
    clearHuntNecroSummons();
    resetAggro();
};

/** Get the list of all monsters (sorted by level) */
export const getAllMonsters = (): IMonster[] => [...monsters].sort((a, b) => a.level - b.level);

// -- Offline Combat Simulation ----------------------------------------------
// When the computer sleeps or browser tab is suspended, JS timers stop.
// On resume, this function calculates how many fights would have happened
// during the offline period and applies the results.

const MAX_OFFLINE_COMBAT_MS = 10 * 60 * 60 * 1000; // 10 hours

export interface IOfflineCombatResult {
    kills: number;
    xpEarned: number;
    goldEarned: number;
    levelUps: number;
    died: boolean;
    elapsedMinutes: number;
}

/**
 * Simulate combat for a period of time that the app was suspended.
 * Uses SKIP-like math to resolve fights.
 * Returns results and applies them to stores.
 */
export const simulateOfflineCombat = (elapsedMs: number): IOfflineCombatResult | null => {
    const cs = useCombatStore.getState();
    const { baseMonster, phase, backgroundStartedAt } = cs;
    const char = useCharacterStore.getState().character;

    if (!baseMonster || !char) return null;
    if (phase !== 'fighting' && phase !== 'victory') return null;

    // Enforce 10h total cap
    if (backgroundStartedAt) {
        const totalElapsed = Date.now() - new Date(backgroundStartedAt).getTime();
        if (totalElapsed > MAX_OFFLINE_COMBAT_MS) {
            // Time's up – stop combat entirely
            stopCombat();
            return null;
        }
        // Cap simulation to remaining time within 10h
        const remaining = MAX_OFFLINE_COMBAT_MS - (totalElapsed - elapsedMs);
        elapsedMs = Math.min(elapsedMs, remaining);
    }

    if (elapsedMs < 5000) return null; // Don't simulate for tiny gaps

    const effChar = getEffectiveChar(char);
    if (!effChar) return null;

    const speed = useSettingsStore.getState().combatSpeed;
    const speedMult = SPEED_MULT[speed] ?? 1;
    const classConfig = getClassConfig(char.class);
    const skillLevels = useSkillStore.getState().skillLevels;
    const classBonus = getClassSkillBonus(char.class, skillLevels);
    const shieldingLevel = skillLevels['shielding'] ?? 0;
    const maxCrit = (classConfig.maxCritChance ?? 30) / 100;

    const playerAttackMs = Math.max(200, getAttackMs(effChar.attack_speed ?? 1) / speedMult);
    const monsterAttackMs = Math.max(200, getAttackMs(baseMonster.speed) / speedMult);

    let totalKills = 0;
    let totalXp = 0;
    let totalGold = 0;
    let levelUps = 0;
    let pHp = cs.playerCurrentHp > 0 ? cs.playerCurrentHp : effChar.max_hp;
    const pMp = cs.playerCurrentMp;
    let died = false;
    let timeUsed = 0;

    const bStore = useBuffStore.getState();
    // 2026-05-08: stacking — 100% drains first, fall back to 50%.
    const offlineHas100 = bStore.hasBuff('xp_boost_100');
    const offlineHas50 = bStore.hasBuff('xp_boost');
    const offlineBaseXp = offlineHas100
      ? bStore.getBuffMultiplier('xp_boost_100')
      : offlineHas50 ? bStore.getBuffMultiplier('xp_boost') : 1;
    const xpMult = offlineBaseXp * bStore.getBuffMultiplier('premium_xp_boost');

    // Simulate fights until time runs out or player dies
    while (timeUsed < elapsedMs && !died) {
        // Roll rarity for this fight
        const masteryBonuses = useMasteryStore.getState().getMasteryBonuses(baseMonster.id);
        const rarity = rollMonsterRarity(false, masteryBonuses);
        const scaledMonster = applyRarityToMonster(baseMonster, rarity);

        // Simulate single fight (like resolveInstantFight)
        let mHp = scaledMonster.hp;
        let fightPHp = pHp;
        let nextPlayer = 0;
        let nextMonster = monsterAttackMs;
        let fightDmg = 0;

        for (let iter = 0; iter < 5000 && mHp > 0 && fightPHp > 0; iter++) {
            if (nextPlayer <= nextMonster) {
                // Player attacks
                if (classConfig.dualWield) {
                    const dw = calculateDualWieldDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        offHandAtk: rollOffHandDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - dw.totalDamage);
                    fightDmg += dw.totalDamage;
                } else {
                    const r = calculateDamage({
                        baseAtk: effChar.attack, weaponAtk: rollWeaponDamage(),
                        skillBonus: classBonus.skillBonus,
                        classModifier: CLASS_MODIFIER[char.class] ?? 1.0,
                        enemyDefense: scaledMonster.defense,
                        critChance: (effChar.crit_chance ?? 0.05) + classBonus.extraCritChance,
                        maxCritChance: maxCrit,
                        damageMultiplier: getAtkDamageMultiplier() * getTransformDmgMultiplier(),
                    });
                    mHp = Math.max(0, mHp - r.finalDamage);
                    fightDmg += r.finalDamage;
                }
                nextPlayer += playerAttackMs;
            } else {
                // Monster attacks
                const isPhysical = !scaledMonster.magical;
                const blockChance = classConfig.canBlock ? calculateBlockChance(shieldingLevel, isPhysical) : 0;
                const dodgeChance = classConfig.canDodge ? calculateDodgeChance(char.class, skillLevels['agility'] ?? 0, isPhysical) : 0;
                const r = calculateDamage({
                    baseAtk: rollMonsterDamage(scaledMonster), weaponAtk: 0, skillBonus: 0,
                    classModifier: 1.0, enemyDefense: effChar.defense,
                    blockChance, dodgeChance,
                });
                fightPHp = Math.max(0, fightPHp - r.finalDamage);
                nextMonster += monsterAttackMs;
            }
        }

        // Estimate fight duration in real ms
        const fightDurationMs = Math.max(nextPlayer, nextMonster);
        timeUsed += fightDurationMs;

        if (mHp <= 0) {
            // Player won
            totalKills++;
            pHp = fightPHp;

            // Mastery N7: read live mastery level per kill (it can level up mid-batch)
            const catchupMasteryLvl = useMasteryStore.getState().getMasteryLevel(baseMonster.id);
            const catchupMasteryXpMult = getMasteryXpMultiplier(catchupMasteryLvl);
            const catchupMasteryGoldMult = getMasteryGoldMultiplier(catchupMasteryLvl);

            // XP (same formula as SKIP mode – 75% efficiency for offline)
            const fightXp = Math.floor(scaledMonster.xp * xpMult * catchupMasteryXpMult * 0.75);
            totalXp += fightXp;

            // Gold
            const fightGold = Math.floor(calculateGoldDrop(scaledMonster.gold) * catchupMasteryGoldMult);
            totalGold += fightGold;

            // Task & quest progress
            const taskKills = MONSTER_RARITY_TASK_KILLS[rarity] ?? 1;
            useTaskStore.getState().addKill(baseMonster.id, baseMonster.level, taskKills);
            useQuestStore.getState().addProgress('kill', baseMonster.id, taskKills);
            useQuestStore.getState().addProgress('kill_rarity', rarity, 1, baseMonster.level);
            useDailyQuestStore.getState().addProgress('kill_any', 1);
            useMasteryStore.getState().addMasteryKills(baseMonster.id, taskKills);

            // Session stats
            useCombatStore.getState().addSessionStats(fightXp, fightGold);
            useCombatStore.getState().incrementSessionKill(rarity);

            // Auto-heal between fights (regen + small heal)
            const regenPerFight = (effChar.hp_regen ?? 0) * (fightDurationMs / 1000);
            pHp = Math.min(effChar.max_hp, pHp + Math.floor(regenPerFight));

            // Apply XP to character
            const xpResult = useCharacterStore.getState().addXp(fightXp);
            if (xpResult.levelsGained > 0) {
                levelUps += xpResult.levelsGained;
            }

            // Add gold
            useInventoryStore.getState().addGold(fightGold);

            // Drop loot (offline – skip auto-sell processing to avoid spam)
            dropLootToInventory(scaledMonster, rarity, 0);
        } else {
            // Player died – stop simulation
            died = true;
            pHp = 0;
        }
    }

    // Update combat store state
    if (died) {
        // Apply death penalty
        handlePlayerDeath();
        useCombatStore.getState().setLastDrops([]);
    } else {
        // Update player HP in combat store, clamped to effective max
        const postEffChar = getEffectiveChar(useCharacterStore.getState().character);
        const postMaxHp = postEffChar?.max_hp ?? pHp;
        const postMaxMp = postEffChar?.max_mp ?? pMp;
        const clampHp = Math.min(postMaxHp, pHp);
        const clampMp = Math.min(postMaxMp, pMp);
        useCombatStore.getState().setHps(0, clampHp);
        useCharacterStore.getState().updateCharacter({ hp: clampHp, mp: clampMp });
        // Set to victory phase so auto-fight resumes
        useCombatStore.getState().setPhase('victory');
    }

    useCombatStore.getState().setLastCombatTickAt(new Date().toISOString());
    void saveCurrentCharacterStores();

    return {
        kills: totalKills,
        xpEarned: totalXp,
        goldEarned: totalGold,
        levelUps,
        died,
        elapsedMinutes: Math.floor(timeUsed / 60000),
    };
};
