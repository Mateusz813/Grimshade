/**
 * Admin Panel — hard-gated debug overlay (krasek39@gmail.com only).
 *
 * 2026-05-21 v2 spec: massive expansion so every gameplay system can
 * be poked at from one place. Each tab targets a single concern + the
 * full set of admin-y knobs we have for it.
 *
 * 2026-05-21 layout fix: rendered via `createPortal(…, document.body)`
 * because the AvatarMenu's `backdrop-filter` creates a new containing
 * block for `position: fixed`. Without the portal the panel anchors
 * inside the menu's bounds and gets clipped at the top.
 *
 * Defense in depth: the button is gated in AvatarMenu, but this
 * component RE-checks the session email + bails out if it doesn't
 * match `ADMIN_EMAIL`.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../../lib/supabase';
import { useCharacterStore } from '../../../stores/characterStore';
import { useInventoryStore } from '../../../stores/inventoryStore';
import { useSkillStore } from '../../../stores/skillStore';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useDailyQuestStore } from '../../../stores/dailyQuestStore';
import { useDungeonStore } from '../../../stores/dungeonStore';
import { useBossStore } from '../../../stores/bossStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useMasteryStore } from '../../../stores/masteryStore';
import { useBuffStore } from '../../../stores/buffStore';
import { useBossScoreStore } from '../../../stores/bossScoreStore';
import { usePartyStore } from '../../../stores/partyStore';
import { useCombatStore } from '../../../stores/combatStore';
import { useOfflineHuntStore } from '../../../stores/offlineHuntStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import { useDeathStore } from '../../../stores/deathStore';
import { useArenaStore } from '../../../stores/arenaStore';
import { generateRandomItem } from '../../../systems/itemGenerator';
import skillsRaw from '../../../data/skills.json';
import bossesRaw from '../../../data/bosses.json';
import dungeonsRaw from '../../../data/dungeons.json';
import monstersRaw from '../../../data/monsters.json';
import questsRaw from '../../../data/quests.json';
import './AdminPanel.scss';

export const ADMIN_EMAIL = 'krasek39@gmail.com';

type TTab = 'char' | 'inv' | 'skill' | 'tasks' | 'quests' | 'walki' | 'social' | 'system' | 'nuke';

interface IAdminPanelProps {
    onClose: () => void;
}

const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic', 'heroic'] as const;

interface ISkillRow { id: string; name_pl: string; class: string; }
interface IBossRow { id: string; name_pl: string; level?: number; }
interface IDungeonRow { id: string; name_pl: string; level?: number; }
interface IMonsterRow { id: string; name_pl: string; level?: number; }
interface IQuestRow { id: string; name_pl?: string; }

// ── Game data lookups ────────────────────────────────────────────────────────
const ALL_SKILLS: ISkillRow[] = (() => {
    const raw = skillsRaw as unknown as {
        weaponSkills?: Array<{ id: string; name_pl: string; class?: string }>;
        activeSkills?: Record<string, Array<{ id: string; name_pl: string }>>;
    };
    const out: ISkillRow[] = [];
    if (Array.isArray(raw.weaponSkills)) {
        for (const s of raw.weaponSkills) out.push({ id: s.id, name_pl: s.name_pl, class: s.class ?? '—' });
    }
    if (raw.activeSkills) {
        for (const [cls, list] of Object.entries(raw.activeSkills)) {
            if (!Array.isArray(list)) continue;
            for (const s of list) out.push({ id: s.id, name_pl: s.name_pl, class: cls });
        }
    }
    return out;
})();

const ALL_BOSSES = (bossesRaw as IBossRow[]).slice().sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
const ALL_DUNGEONS = (dungeonsRaw as IDungeonRow[]).slice().sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
const ALL_MONSTERS = (monstersRaw as IMonsterRow[]).slice().sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
const ALL_QUESTS = (questsRaw as unknown as IQuestRow[]) ?? [];

const ALL_CLASSES = ['Knight', 'Mage', 'Cleric', 'Archer', 'Rogue', 'Necromancer', 'Bard'] as const;
const ARENA_LEAGUES = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Master', 'Grandmaster'] as const;

const AdminPanel = ({ onClose }: IAdminPanelProps) => {
    const [authorised, setAuthorised] = useState<boolean | null>(null);
    const [tab, setTab] = useState<TTab>('char');
    const [toast, setToast] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const { data } = await supabase.auth.getSession();
            if (cancelled) return;
            const email = data.session?.user?.email?.toLowerCase() ?? null;
            setAuthorised(email === ADMIN_EMAIL.toLowerCase());
        })();
        return () => { cancelled = true; };
    }, []);

    const flash = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 1500);
    };

    const character = useCharacterStore((s) => s.character);

    // ════════════════════════════════════════════════════════════════════
    // POSTAĆ
    // ════════════════════════════════════════════════════════════════════
    const updateCharacter = useCharacterStore((s) => s.updateCharacter);
    const fullHealEffective = useCharacterStore((s) => s.fullHealEffective);

    const [levelInput, setLevelInput] = useState('100');
    const [xpPctInput, setXpPctInput] = useState('100');
    const [goldInput, setGoldInput] = useState('1000000');
    const [statPtsInput, setStatPtsInput] = useState('1000');
    const [attackInput, setAttackInput] = useState('1000');
    const [defenseInput, setDefenseInput] = useState('1000');
    const [magicLvlInput, setMagicLvlInput] = useState('100');
    const [highestLvlInput, setHighestLvlInput] = useState('500');
    const [critChanceInput, setCritChanceInput] = useState('50');
    const [critDmgInput, setCritDmgInput] = useState('3');
    const [hpRegenInput, setHpRegenInput] = useState('50');
    const [mpRegenInput, setMpRegenInput] = useState('50');
    const [atkSpeedInput, setAtkSpeedInput] = useState('200');
    const [hpInput, setHpInput] = useState('99999');
    const [mpInput, setMpInput] = useState('99999');

    const setLevel = () => {
        const n = Math.max(1, Math.min(1000, parseInt(levelInput, 10) || 1));
        updateCharacter({ level: n, xp: 0 });
        flash(`Poziom = ${n}`);
    };
    const addXpPct = () => {
        if (!character) return;
        const pct = Math.max(0, parseInt(xpPctInput, 10) || 0);
        void import('../../../systems/levelSystem').then(({ processXpGain, xpToNextLevel }) => {
            const c = useCharacterStore.getState().character;
            if (!c) return;
            const xpDelta = Math.floor((pct / 100) * xpToNextLevel(c.level));
            const result = processXpGain(c.level, c.xp, xpDelta);
            updateCharacter({ level: result.newLevel, xp: result.remainingXp });
            flash(`+${pct}% XP (lvl ${c.level} → ${result.newLevel})`);
        });
    };
    const setGold = () => {
        const n = Math.max(0, parseInt(goldInput, 10) || 0);
        useInventoryStore.setState({ gold: n });
        flash(`Gold = ${n.toLocaleString('pl-PL')}`);
    };
    const setStatPts = () => {
        const n = Math.max(0, parseInt(statPtsInput, 10) || 0);
        updateCharacter({ stat_points: n });
        flash(`Punkty statystyk = ${n}`);
    };
    const setAtkDef = (k: 'attack' | 'defense') => {
        const n = Math.max(0, parseInt(k === 'attack' ? attackInput : defenseInput, 10) || 0);
        updateCharacter({ [k]: n });
        flash(`${k === 'attack' ? 'Atak' : 'Obrona'} = ${n}`);
    };
    const setMagicLvl = () => {
        const n = Math.max(0, parseInt(magicLvlInput, 10) || 0);
        updateCharacter({ magic_level: n });
        useSkillStore.setState((s) => ({
            skillLevels: { ...s.skillLevels, magic_level: n },
            skillXp: { ...s.skillXp, magic_level: 0 },
        }));
        flash(`Magic Level = ${n}`);
    };
    const setHighestLvl = () => {
        const n = Math.max(1, parseInt(highestLvlInput, 10) || 1);
        updateCharacter({ highest_level: n });
        flash(`Highest Level = ${n}`);
    };
    const setCrit = () => {
        const ch = Math.max(0, Math.min(50, parseFloat(critChanceInput) || 0)) / 100;
        const cd = Math.max(1, parseFloat(critDmgInput) || 1);
        updateCharacter({ crit_chance: ch, crit_damage: cd });
        flash(`Crit ${(ch * 100).toFixed(1)}% / x${cd}`);
    };
    const setRegen = () => {
        updateCharacter({
            hp_regen: Math.max(0, parseFloat(hpRegenInput) || 0),
            mp_regen: Math.max(0, parseFloat(mpRegenInput) || 0),
        });
        flash('Regen ustawiony');
    };
    const setAtkSpeed = () => {
        updateCharacter({ attack_speed: Math.max(0, parseFloat(atkSpeedInput) || 0) });
        flash(`Attack Speed = ${atkSpeedInput}`);
    };
    const setHpMp = () => {
        const hp = Math.max(0, parseInt(hpInput, 10) || 0);
        const mp = Math.max(0, parseInt(mpInput, 10) || 0);
        updateCharacter({ hp, mp, max_hp: Math.max(hp, character?.max_hp ?? hp), max_mp: Math.max(mp, character?.max_mp ?? mp) });
        flash(`HP/MP = ${hp}/${mp}`);
    };

    // ════════════════════════════════════════════════════════════════════
    // INVENTORY
    // ════════════════════════════════════════════════════════════════════
    const [itemRarity, setItemRarity] = useState<typeof RARITIES[number]>('legendary');
    const [itemLevel, setItemLevel] = useState('500');
    const [itemCount, setItemCount] = useState('1');
    const [itemUpgradeLvl, setItemUpgradeLvl] = useState('20');
    const [arenaPtsInput, setArenaPtsInput] = useState('5000');
    const [stoneAmount, setStoneAmount] = useState('100');
    const [potionAmount, setPotionAmount] = useState('50');
    const [spellChestLevel, setSpellChestLevel] = useState('100');
    const [spellChestCount, setSpellChestCount] = useState('10');

    const generateItems = () => {
        const lvl = Math.max(1, Math.min(1000, parseInt(itemLevel, 10) || 1));
        const count = Math.max(1, Math.min(50, parseInt(itemCount, 10) || 1));
        const upLvl = Math.max(0, Math.min(30, parseInt(itemUpgradeLvl, 10) || 0));
        let created = 0;
        for (let i = 0; i < count; i++) {
            const item = generateRandomItem(lvl, itemRarity);
            if (item) {
                if (upLvl > 0) item.upgradeLevel = upLvl;
                useInventoryStore.getState().restoreItem(item);
                created += 1;
            }
        }
        flash(`+${created}× ${itemRarity} Lv${lvl}${upLvl > 0 ? ` +${upLvl}` : ''}`);
    };

    const addStones = (kind: string) => {
        const n = Math.max(1, parseInt(stoneAmount, 10) || 1);
        useInventoryStore.getState().addStones(kind, n);
        flash(`+${n} ${kind}`);
    };
    const addConsumable = (id: string) => {
        const n = Math.max(1, parseInt(potionAmount, 10) || 1);
        useInventoryStore.getState().addConsumable(id, n);
        flash(`+${n}× ${id}`);
    };
    const addSpellChest = () => {
        const lvl = Math.max(1, Math.min(1000, parseInt(spellChestLevel, 10) || 1));
        const n = Math.max(1, parseInt(spellChestCount, 10) || 1);
        // Spell chests are stored as consumables keyed `spell_chest_${level}`
        // (see inventoryStore lines 481+). Use the consumable API so the
        // bookkeeping (counts, sync) goes through the canonical path.
        useInventoryStore.getState().addConsumable(`spell_chest_${lvl}`, n);
        flash(`+${n}× Spell Chest Lv${lvl}`);
    };
    const setArenaPoints = () => {
        const n = Math.max(0, parseInt(arenaPtsInput, 10) || 0);
        useInventoryStore.setState({ arenaPoints: n });
        flash(`Arena Points = ${n}`);
    };
    const clearBag = () => {
        useInventoryStore.setState({ bag: [] });
        flash('Plecak wyczyszczony');
    };

    // ════════════════════════════════════════════════════════════════════
    // SKILLE
    // ════════════════════════════════════════════════════════════════════
    const [skillId, setSkillId] = useState<string>(ALL_SKILLS[0]?.id ?? '');
    const [skillLevel, setSkillLevel] = useState('100');
    const [skillUpgradeLvl, setSkillUpgradeLvl] = useState('30');
    const [slotIdx, setSlotIdx] = useState('0');

    const setSingleSkillLevel = () => {
        if (!skillId) return;
        const lvl = Math.max(0, Math.min(1000, parseInt(skillLevel, 10) || 0));
        useSkillStore.setState((s) => ({
            skillLevels: { ...s.skillLevels, [skillId]: lvl },
            skillXp: { ...s.skillXp, [skillId]: 0 },
        }));
        flash(`${skillId} → Lvl ${lvl}`);
    };
    const setSkillUpgradeLevel = () => {
        if (!skillId) return;
        const lvl = Math.max(0, Math.min(30, parseInt(skillUpgradeLvl, 10) || 0));
        useSkillStore.setState((s) => ({
            skillUpgradeLevels: { ...s.skillUpgradeLevels, [skillId]: lvl },
        }));
        flash(`${skillId} → +${lvl}`);
    };
    const unlockSkill = () => {
        if (!skillId) return;
        useSkillStore.setState((s) => ({
            unlockedSkills: { ...s.unlockedSkills, [skillId]: true },
        }));
        flash(`${skillId} odblokowany`);
    };
    const slotSkill = () => {
        if (!skillId) return;
        const slot = Math.max(0, Math.min(3, parseInt(slotIdx, 10) || 0));
        useSkillStore.getState().setActiveSkillSlot(slot as 0 | 1 | 2 | 3, skillId);
        flash(`Slot ${slot + 1} = ${skillId}`);
    };
    const maxAllSkills = () => {
        const updates: Record<string, number> = {};
        const xpUpdates: Record<string, number> = {};
        const unlocked: Record<string, boolean> = {};
        for (const s of ALL_SKILLS) {
            updates[s.id] = 100;
            xpUpdates[s.id] = 0;
            unlocked[s.id] = true;
        }
        useSkillStore.setState((st) => ({
            skillLevels: { ...st.skillLevels, ...updates },
            skillXp: { ...st.skillXp, ...xpUpdates },
            unlockedSkills: { ...st.unlockedSkills, ...unlocked },
        }));
        flash('Wszystkie skille → Lvl 100 + odblokowane');
    };
    const maxAllUpgrades = () => {
        const upgrades: Record<string, number> = {};
        for (const s of ALL_SKILLS) upgrades[s.id] = 30;
        useSkillStore.setState((st) => ({
            skillUpgradeLevels: { ...st.skillUpgradeLevels, ...upgrades },
        }));
        flash('Wszystkie skille → +30');
    };

    // ════════════════════════════════════════════════════════════════════
    // TASKS
    // ════════════════════════════════════════════════════════════════════
    const [killMonsterId, setKillMonsterId] = useState('');
    const [killMonsterLevel, setKillMonsterLevel] = useState('1');
    const [killCount, setKillCount] = useState('5000');
    const [masteryLvl, setMasteryLvl] = useState('30');

    const monsterPicked = useMemo(
        () => ALL_MONSTERS.find((m) => m.id === killMonsterId) ?? null,
        [killMonsterId],
    );

    const bumpKills = () => {
        if (!killMonsterId) return;
        const lvl = Math.max(1, parseInt(killMonsterLevel, 10) || (monsterPicked?.level ?? 1));
        const count = Math.max(1, parseInt(killCount, 10) || 1);
        useTaskStore.getState().addKill(killMonsterId, lvl, count);
        useMasteryStore.getState().addMasteryKills(killMonsterId, count);
        flash(`+${count} zabić ${killMonsterId} (Lv${lvl})`);
    };
    const setMasteryDirect = () => {
        if (!killMonsterId) return;
        const lvl = Math.max(0, Math.min(100, parseInt(masteryLvl, 10) || 0));
        useMasteryStore.setState((s) => ({
            masteries: { ...s.masteries, [killMonsterId]: { level: lvl, kills: 9999 } },
        }));
        flash(`Mastery ${killMonsterId} = Lv${lvl}`);
    };
    const completeAllActiveTasks = () => {
        useTaskStore.setState((s) => ({
            activeTasks: s.activeTasks.map((t) => ({ ...t, progress: t.killCount })),
        }));
        flash('Wszystkie taski → ukończone');
    };
    const resetTasks = () => {
        useTaskStore.setState({ activeTasks: [], completedTasks: [] });
        flash('Taski wyczyszczone');
    };

    // ════════════════════════════════════════════════════════════════════
    // QUESTS
    // ════════════════════════════════════════════════════════════════════
    const [questIdInput, setQuestIdInput] = useState<string>(ALL_QUESTS[0]?.id ?? '');

    const completeQuest = () => {
        if (!questIdInput) return;
        useQuestStore.setState((s) => ({
            activeQuests: s.activeQuests.map((q) =>
                q.questId === questIdInput
                    ? { ...q, goals: q.goals.map((g) => ({ ...g, progress: g.count })) }
                    : q,
            ),
        }));
        flash(`Quest ${questIdInput} → ukończony (gotowy do odbioru)`);
    };
    const markQuestClaimed = () => {
        if (!questIdInput) return;
        useQuestStore.setState((s) => ({
            activeQuests: s.activeQuests.filter((q) => q.questId !== questIdInput),
            completedQuestIds: s.completedQuestIds.includes(questIdInput)
                ? s.completedQuestIds
                : [...s.completedQuestIds, questIdInput],
        }));
        flash(`Quest ${questIdInput} → odebrany`);
    };
    const completeAllActiveQuests = () => {
        useQuestStore.setState((s) => ({
            activeQuests: s.activeQuests.map((q) => ({
                ...q,
                goals: q.goals.map((g) => ({ ...g, progress: g.count })),
            })),
        }));
        flash('Wszystkie aktywne questy → ukończone');
    };
    const resetQuests = () => {
        useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
        flash('Questy wyczyszczone');
    };

    const completeAllDaily = () => {
        // Daily quests gate on `completed: true` — that's enough for the
        // claim UI; the progress bar will read as full from this flag.
        useDailyQuestStore.setState((s) => ({
            activeQuests: s.activeQuests.map((q) => ({ ...q, progress: 99999, completed: true })),
        }));
        flash('Wszystkie daily → ukończone');
    };
    const claimAllDaily = () => {
        useDailyQuestStore.setState((s) => ({
            activeQuests: s.activeQuests.map((q) => ({ ...q, claimed: true })),
        }));
        flash('Wszystkie daily → odebrane');
    };
    const resetDailyQuests = () => {
        useDailyQuestStore.getState().resetDailyQuests();
        flash('Daily zresetowane');
    };

    // ════════════════════════════════════════════════════════════════════
    // WALKI — bossy / lochy / transformy / mastery / raidy
    // ════════════════════════════════════════════════════════════════════
    const [bossId, setBossId] = useState<string>(ALL_BOSSES[0]?.id ?? '');
    const [dungeonId, setDungeonId] = useState<string>(ALL_DUNGEONS[0]?.id ?? '');
    const [transformTier, setTransformTier] = useState('1');
    const [bossKillsInput, setBossKillsInput] = useState('100');

    const markBossDefeated = () => {
        if (!bossId) return;
        useBossStore.getState().setBossDefeated(bossId);
        flash(`${bossId} → pokonany`);
    };
    const refundBossAttempts = () => {
        useBossStore.setState((s) => {
            const next = { ...s.dailyAttempts };
            if (bossId) delete next[bossId];
            return { dailyAttempts: next };
        });
        flash(bossId ? `${bossId} → attempts refunded` : 'wszystkie bossy refund');
    };
    const setBossKills = () => {
        const n = Math.max(0, parseInt(bossKillsInput, 10) || 0);
        // bossScoreStore stores per-boss kill entries as `bossKills[id] = { count, lastKill }`.
        useBossScoreStore.setState((s) => ({
            bossKills: {
                ...s.bossKills,
                [bossId]: { count: n, lastKill: new Date().toISOString() },
            },
        }));
        flash(`Boss ${bossId} kills = ${n}`);
    };
    const resetBosses = () => {
        useBossStore.setState({ dailyAttempts: {}, lastResult: null });
        flash('Bossy zresetowane');
    };

    const markDungeonCleared = () => {
        if (!dungeonId) return;
        useDungeonStore.getState().setDungeonCompleted(dungeonId);
        flash(`${dungeonId} → ukończony`);
    };
    const refundDungeonAttempts = () => {
        useDungeonStore.setState((s) => {
            const next = { ...s.dailyAttempts };
            if (dungeonId) delete next[dungeonId];
            return { dailyAttempts: next };
        });
        flash(dungeonId ? `${dungeonId} → attempts refunded` : 'wszystkie lochy refund');
    };
    const resetDungeons = () => {
        useDungeonStore.setState({ dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null });
        flash('Lochy zresetowane (dzienne + cleared)');
    };
    const clearAllDailyAttempts = () => {
        useDungeonStore.setState({ dailyAttempts: {} });
        useBossStore.setState({ dailyAttempts: {} });
        flash('Wszystkie attempts wyzerowane');
    };

    const unlockTransformTier = () => {
        const tier = Math.max(1, Math.min(12, parseInt(transformTier, 10) || 1));
        useTransformStore.setState((s) => ({
            completedTransforms: s.completedTransforms.includes(tier)
                ? s.completedTransforms
                : [...s.completedTransforms, tier],
        }));
        flash(`Transform Tier ${tier} → ukończony`);
    };
    const unlockAllTransforms = () => {
        useTransformStore.setState({
            completedTransforms: Array.from({ length: 12 }, (_, i) => i + 1),
            currentTransformQuest: null,
        });
        flash('Wszystkie transformy ON');
    };
    const abandonTransformQuest = () => {
        useTransformStore.getState().abandonTransformQuest();
        flash('Transform quest porzucony');
    };
    const resetTransforms = () => {
        useTransformStore.setState({
            completedTransforms: [],
            currentTransformQuest: null,
            bakedBonusesApplied: false,
        });
        flash('Transformy zresetowane');
    };

    // ════════════════════════════════════════════════════════════════════
    // SOCIAL — party / arena / guild / market
    // ════════════════════════════════════════════════════════════════════
    const [arenaKills, setArenaKills] = useState('100');
    const [arenaDeaths, setArenaDeaths] = useState('0');
    const [arenaLeague, setArenaLeague] = useState<typeof ARENA_LEAGUES[number]>('Diamond');
    const [arenaLP, setArenaLP] = useState('5000');

    const setArenaStats = () => {
        if (!character) return;
        const ak = Math.max(0, parseInt(arenaKills, 10) || 0);
        const ad = Math.max(0, parseInt(arenaDeaths, 10) || 0);
        const lp = Math.max(0, parseInt(arenaLP, 10) || 0);
        // `updateCharacter` is typed against the narrow API ICharacter
        // (no arena fields). The DB row + the extended `types/character.ts`
        // ICharacter both include them — cast to `Record<string, unknown>`
        // so TypeScript stops gating on the narrow type.
        updateCharacter({
            arena_kills: ak,
            arena_deaths: ad,
            arena_league: arenaLeague,
            arena_league_points: lp,
        } as unknown as Parameters<typeof updateCharacter>[0]);
        flash(`Arena: ${ak}K/${ad}D · ${arenaLeague} · ${lp} LP`);
    };

    const leaveActiveParty = () => {
        if (!character) return;
        void usePartyStore.getState().leaveParty(character.id);
        flash('Party opuszczone');
    };

    const clearMarketState = () => {
        // Best-effort — market store isn't loaded if user never opened Market.
        void import('../../../stores/marketStore').then(({ useMarketStore }) => {
            useMarketStore.setState({ saleNotifications: [] });
            flash('Powiadomienia market wyczyszczone');
        }).catch(() => { flash('Market store niedostępny'); });
    };

    // ════════════════════════════════════════════════════════════════════
    // SYSTEM — connectivity / combat / buffs / death / offline hunt
    // ════════════════════════════════════════════════════════════════════
    const playMode = useConnectivityStore((s) => s.mode);
    const [buffId, setBuffId] = useState('hp_boost_pct');
    const [buffDuration, setBuffDuration] = useState('3600');

    const toggleMode = async () => {
        const { transitionToOffline, transitionToOnline } = await import('../../../systems/connectivityTransitions');
        if (playMode === 'online') {
            transitionToOffline({ explicit: true });
            flash('Tryb → offline');
        } else {
            await transitionToOnline();
            flash('Tryb → online + sync');
        }
    };
    const forceSync = async () => {
        const { saveCurrentCharacterStores } = await import('../../../stores/characterScope');
        try {
            await saveCurrentCharacterStores();
            flash('Sync zapisany');
        } catch {
            flash('Sync failed');
        }
    };
    const clearCombatSession = () => {
        useCombatStore.getState().clearCombatSession();
        flash('Combat session wyczyszczona');
    };
    const stopOfflineHunt = () => {
        useOfflineHuntStore.getState().stopHunt();
        flash('Offline hunt zatrzymany');
    };
    const addBuff = () => {
        const dur = Math.max(60, parseInt(buffDuration, 10) || 60);
        // Use the typed `addBuff` action — fills in characterId / timer
        // mode / remainingMs for us.
        useBuffStore.getState().addBuff(
            {
                id: `admin_${buffId}_${Date.now()}`,
                name: `Admin: ${buffId}`,
                icon: '⚡',
                effect: buffId,
            },
            dur * 1000,
        );
        flash(`Buff ${buffId} +${dur}s`);
    };
    const clearAllBuffs = () => {
        // No public reset action — the canonical store key is `allBuffs`.
        useBuffStore.setState({ allBuffs: [] });
        flash('Buffy wyczyszczone');
    };
    const triggerFakeDeath = () => {
        if (!character) return;
        useDeathStore.getState().triggerDeath({
            killedBy: 'Admin Panel',
            sourceLevel: 1,
            oldLevel: character.level,
            newLevel: character.level,
            levelsLost: 0,
            xpPercent: 0,
            skillXpLossPercent: 0,
            protectionUsed: true,
            source: 'monster',
        });
        flash('Death overlay wystrzelony');
    };
    const clearDeathEvent = () => {
        useDeathStore.setState({ event: null });
        flash('Death overlay wyłączony');
    };
    const clearOfflineSnapshot = () => {
        useConnectivityStore.getState().setSnapshot(null);
        flash('Offline snapshot wyczyszczony');
    };
    const clearArenaState = () => {
        useArenaStore.setState({ currentArena: null });
        flash('Arena state wyczyszczony');
    };

    // ════════════════════════════════════════════════════════════════════
    // NUKE
    // ════════════════════════════════════════════════════════════════════
    const [confirmNuke, setConfirmNuke] = useState(false);
    const nuke = () => {
        if (!confirmNuke) {
            setConfirmNuke(true);
            setTimeout(() => setConfirmNuke(false), 3000);
            return;
        }
        useSkillStore.getState().resetSkills();
        useTaskStore.setState({ activeTasks: [], completedTasks: [] });
        useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
        useDailyQuestStore.getState().resetDailyQuests();
        useDungeonStore.setState({ dailyAttempts: {}, clearedDungeonIds: {}, lastResult: null });
        useBossStore.setState({ dailyAttempts: {}, lastResult: null });
        useTransformStore.setState({ completedTransforms: [], currentTransformQuest: null });
        useMasteryStore.setState({ masteries: {} });
        useBuffStore.setState({ allBuffs: [] });
        flash('Wszystkie postępy wyczyszczone');
        setConfirmNuke(false);
    };

    if (authorised === null) return null;
    if (!authorised) return null;

    const panelNode = (
        <div className="admin-panel__backdrop" onClick={onClose}>
            <div
                className="admin-panel"
                role="dialog"
                aria-label="Panel administratora"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="admin-panel__header">
                    <span className="admin-panel__title">🛠️ Panel Admina</span>
                    <button
                        type="button"
                        className="admin-panel__close"
                        onClick={onClose}
                        aria-label="Zamknij"
                    >
                        ✕
                    </button>
                </header>

                <nav className="admin-panel__tabs">
                    <TabBtn current={tab} value="char"   label="🧙 Postać"   onClick={setTab} />
                    <TabBtn current={tab} value="inv"    label="🎒 Inv"      onClick={setTab} />
                    <TabBtn current={tab} value="skill"  label="✨ Skille"   onClick={setTab} />
                    <TabBtn current={tab} value="tasks"  label="📜 Tasks"    onClick={setTab} />
                    <TabBtn current={tab} value="quests" label="📖 Questy"   onClick={setTab} />
                    <TabBtn current={tab} value="walki"  label="🏰 Walki"    onClick={setTab} />
                    <TabBtn current={tab} value="social" label="👥 Społ."    onClick={setTab} />
                    <TabBtn current={tab} value="system" label="⚙️ System"  onClick={setTab} />
                    <TabBtn current={tab} value="nuke"   label="💀 Reset"    onClick={setTab} />
                </nav>

                <div className="admin-panel__body">
                    {tab === 'char' && (
                        <section className="admin-panel__section">
                            <h3>{character?.name ?? '—'} · {character?.class ?? '—'} · Lvl {character?.level ?? '—'}</h3>

                            <FieldRow label="Poziom (1-1000)">
                                <input type="number" value={levelInput} onChange={(e) => setLevelInput(e.target.value)} min={1} max={1000} />
                                <button onClick={setLevel}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="+ XP (% bieżącego poziomu)">
                                <input type="number" value={xpPctInput} onChange={(e) => setXpPctInput(e.target.value)} />
                                <button onClick={addXpPct}>Dodaj</button>
                            </FieldRow>
                            <FieldRow label="Gold">
                                <input type="number" value={goldInput} onChange={(e) => setGoldInput(e.target.value)} min={0} />
                                <button onClick={setGold}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Punkty statystyk">
                                <input type="number" value={statPtsInput} onChange={(e) => setStatPtsInput(e.target.value)} min={0} />
                                <button onClick={setStatPts}>Ustaw</button>
                            </FieldRow>

                            <h3>Combat stats</h3>
                            <FieldRow label="Atak (base)">
                                <input type="number" value={attackInput} onChange={(e) => setAttackInput(e.target.value)} min={0} />
                                <button onClick={() => setAtkDef('attack')}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Obrona (base)">
                                <input type="number" value={defenseInput} onChange={(e) => setDefenseInput(e.target.value)} min={0} />
                                <button onClick={() => setAtkDef('defense')}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Magic Level">
                                <input type="number" value={magicLvlInput} onChange={(e) => setMagicLvlInput(e.target.value)} min={0} />
                                <button onClick={setMagicLvl}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Crit % (0-50) / Crit DMG (×)">
                                <input type="number" step="0.1" value={critChanceInput} onChange={(e) => setCritChanceInput(e.target.value)} placeholder="%" />
                                <input type="number" step="0.1" value={critDmgInput} onChange={(e) => setCritDmgInput(e.target.value)} placeholder="×" />
                                <button onClick={setCrit}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="HP regen / MP regen (na sek.)">
                                <input type="number" value={hpRegenInput} onChange={(e) => setHpRegenInput(e.target.value)} placeholder="HP/s" />
                                <input type="number" value={mpRegenInput} onChange={(e) => setMpRegenInput(e.target.value)} placeholder="MP/s" />
                                <button onClick={setRegen}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Attack Speed (ms cooldown)">
                                <input type="number" value={atkSpeedInput} onChange={(e) => setAtkSpeedInput(e.target.value)} />
                                <button onClick={setAtkSpeed}>Ustaw</button>
                            </FieldRow>

                            <h3>HP / MP</h3>
                            <FieldRow label="HP current">
                                <input type="number" value={hpInput} onChange={(e) => setHpInput(e.target.value)} />
                            </FieldRow>
                            <FieldRow label="MP current">
                                <input type="number" value={mpInput} onChange={(e) => setMpInput(e.target.value)} />
                                <button onClick={setHpMp}>Ustaw oba</button>
                            </FieldRow>
                            <FieldRow label="Akcje">
                                <button onClick={fullHealEffective}>Pełne HP/MP</button>
                            </FieldRow>

                            <h3>Metadane</h3>
                            <FieldRow label="Highest Level (ranking)">
                                <input type="number" value={highestLvlInput} onChange={(e) => setHighestLvlInput(e.target.value)} min={1} />
                                <button onClick={setHighestLvl}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Klasa">
                                <select
                                    value={character?.class ?? 'Knight'}
                                    onChange={(e) => updateCharacter({ class: e.target.value as 'Knight' })}
                                >
                                    {ALL_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </FieldRow>
                        </section>
                    )}

                    {tab === 'inv' && (
                        <section className="admin-panel__section">
                            <h3>Generator przedmiotów</h3>
                            <FieldRow label="Rarity">
                                <select value={itemRarity} onChange={(e) => setItemRarity(e.target.value as typeof RARITIES[number])}>
                                    {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </FieldRow>
                            <FieldRow label="Poziom (1-1000)">
                                <input type="number" value={itemLevel} onChange={(e) => setItemLevel(e.target.value)} min={1} max={1000} />
                            </FieldRow>
                            <FieldRow label="Upgrade lvl (+0..+30)">
                                <input type="number" value={itemUpgradeLvl} onChange={(e) => setItemUpgradeLvl(e.target.value)} min={0} max={30} />
                            </FieldRow>
                            <FieldRow label="Ilość (1-50)">
                                <input type="number" value={itemCount} onChange={(e) => setItemCount(e.target.value)} min={1} max={50} />
                                <button onClick={generateItems}>Wygeneruj</button>
                            </FieldRow>

                            <h3>Kamienie ulepszania</h3>
                            <FieldRow label="Ilość per klik">
                                <input type="number" value={stoneAmount} onChange={(e) => setStoneAmount(e.target.value)} min={1} />
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={() => addStones('common_stone')}>Zwykłe</button>
                                <button onClick={() => addStones('rare_stone')}>Rzadkie</button>
                                <button onClick={() => addStones('epic_stone')}>Epickie</button>
                                <button onClick={() => addStones('legendary_stone')}>Legendarne</button>
                                <button onClick={() => addStones('mythic_stone')}>Mityczne</button>
                                <button onClick={() => addStones('heroic_stone')}>Heroiczne</button>
                            </div>

                            <h3>Mikstury / eliksiry</h3>
                            <FieldRow label="Ilość per klik">
                                <input type="number" value={potionAmount} onChange={(e) => setPotionAmount(e.target.value)} min={1} />
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={() => addConsumable('hp_potion')}>HP Pot</button>
                                <button onClick={() => addConsumable('mp_potion')}>MP Pot</button>
                                <button onClick={() => addConsumable('death_protection')}>Eliksir Ochrony</button>
                                <button onClick={() => addConsumable('amulet_of_loss')}>Amulet of Loss</button>
                                <button onClick={() => addConsumable('hp_elixir_500')}>HP+500 Elixir</button>
                                <button onClick={() => addConsumable('mp_elixir_500')}>MP+500 Elixir</button>
                                <button onClick={() => addConsumable('atk_elixir')}>Atk Elixir</button>
                                <button onClick={() => addConsumable('def_elixir')}>Def Elixir</button>
                                <button onClick={() => addConsumable('speed_elixir')}>Speed Elixir</button>
                            </div>

                            <h3>Spell Chests</h3>
                            <FieldRow label="Level chesta">
                                <input type="number" value={spellChestLevel} onChange={(e) => setSpellChestLevel(e.target.value)} min={1} max={1000} />
                            </FieldRow>
                            <FieldRow label="Ilość">
                                <input type="number" value={spellChestCount} onChange={(e) => setSpellChestCount(e.target.value)} min={1} />
                                <button onClick={addSpellChest}>Dodaj</button>
                            </FieldRow>

                            <h3>Arena / Bag</h3>
                            <FieldRow label="Arena Points">
                                <input type="number" value={arenaPtsInput} onChange={(e) => setArenaPtsInput(e.target.value)} min={0} />
                                <button onClick={setArenaPoints}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Akcje">
                                <button onClick={clearBag} className="admin-panel__danger-btn">🗑 Wyczyść plecak</button>
                            </FieldRow>
                        </section>
                    )}

                    {tab === 'skill' && (
                        <section className="admin-panel__section">
                            <h3>Skille</h3>
                            <FieldRow label="Skill">
                                <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
                                    {ALL_SKILLS.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name_pl ?? s.id} · {s.class}
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>

                            <FieldRow label="Poziom skilla (0-1000)">
                                <input type="number" value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} min={0} max={1000} />
                                <button onClick={setSingleSkillLevel}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Upgrade level (+0..+30)">
                                <input type="number" value={skillUpgradeLvl} onChange={(e) => setSkillUpgradeLvl(e.target.value)} min={0} max={30} />
                                <button onClick={setSkillUpgradeLevel}>Ustaw</button>
                            </FieldRow>
                            <FieldRow label="Odblokuj skill (active)">
                                <button onClick={unlockSkill}>Odblokuj</button>
                            </FieldRow>
                            <FieldRow label="Slot do aktywnego (0-3)">
                                <input type="number" value={slotIdx} onChange={(e) => setSlotIdx(e.target.value)} min={0} max={3} />
                                <button onClick={slotSkill}>Wstaw do slotu</button>
                            </FieldRow>

                            <h3>Akcje masowe</h3>
                            <div className="admin-panel__grid">
                                <button onClick={maxAllSkills}>Wszystkie → Lvl 100 + odblok.</button>
                                <button onClick={maxAllUpgrades}>Wszystkie upgrades → +30</button>
                            </div>
                        </section>
                    )}

                    {tab === 'tasks' && (
                        <section className="admin-panel__section">
                            <h3>Zabijanie potworów (taski + mastery)</h3>
                            <FieldRow label="Potwór">
                                <select value={killMonsterId} onChange={(e) => {
                                    setKillMonsterId(e.target.value);
                                    const m = ALL_MONSTERS.find((mm) => mm.id === e.target.value);
                                    if (m?.level) setKillMonsterLevel(String(m.level));
                                }}>
                                    <option value="">— wybierz —</option>
                                    {ALL_MONSTERS.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.name_pl ?? m.id} (Lv{m.level ?? '?'})
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>
                            <FieldRow label="Lvl potwora">
                                <input type="number" value={killMonsterLevel} onChange={(e) => setKillMonsterLevel(e.target.value)} min={1} />
                            </FieldRow>
                            <FieldRow label="Ilość zabić">
                                <input type="number" value={killCount} onChange={(e) => setKillCount(e.target.value)} min={1} />
                                <button onClick={bumpKills}>Zalicz</button>
                            </FieldRow>
                            <FieldRow label="Mastery direct (0-100)">
                                <input type="number" value={masteryLvl} onChange={(e) => setMasteryLvl(e.target.value)} min={0} max={100} />
                                <button onClick={setMasteryDirect}>Ustaw</button>
                            </FieldRow>

                            <h3>Bulk akcje</h3>
                            <div className="admin-panel__grid">
                                <button onClick={completeAllActiveTasks}>Ukończ wszystkie aktywne</button>
                                <button onClick={resetTasks} className="admin-panel__danger-btn">🗑 Reset tasków</button>
                            </div>
                        </section>
                    )}

                    {tab === 'quests' && (
                        <section className="admin-panel__section">
                            <h3>Questy fabularne</h3>
                            <FieldRow label="Quest ID">
                                <select value={questIdInput} onChange={(e) => setQuestIdInput(e.target.value)}>
                                    <option value="">— wybierz —</option>
                                    {ALL_QUESTS.map((q) => (
                                        <option key={q.id} value={q.id}>
                                            {q.name_pl ?? q.id}
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={completeQuest}>Ukończ (gotowy do odbioru)</button>
                                <button onClick={markQuestClaimed}>Oznacz odebrany</button>
                            </div>

                            <h3>Bulk</h3>
                            <div className="admin-panel__grid">
                                <button onClick={completeAllActiveQuests}>Ukończ wszystkie aktywne</button>
                                <button onClick={resetQuests} className="admin-panel__danger-btn">🗑 Reset questów</button>
                            </div>

                            <h3>Daily questy</h3>
                            <div className="admin-panel__grid">
                                <button onClick={completeAllDaily}>Ukończ wszystkie daily</button>
                                <button onClick={claimAllDaily}>Odbierz wszystkie daily</button>
                                <button onClick={resetDailyQuests} className="admin-panel__danger-btn">🗑 Reset daily</button>
                            </div>
                        </section>
                    )}

                    {tab === 'walki' && (
                        <section className="admin-panel__section">
                            <h3>Bossy</h3>
                            <FieldRow label="Boss">
                                <select value={bossId} onChange={(e) => setBossId(e.target.value)}>
                                    {ALL_BOSSES.map((b) => (
                                        <option key={b.id} value={b.id}>
                                            {b.name_pl ?? b.id} (Lv{b.level ?? '?'})
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>
                            <FieldRow label="Boss kills (ranking)">
                                <input type="number" value={bossKillsInput} onChange={(e) => setBossKillsInput(e.target.value)} min={0} />
                                <button onClick={setBossKills}>Ustaw</button>
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={markBossDefeated}>Pokonany</button>
                                <button onClick={refundBossAttempts}>Refund attempts</button>
                                <button onClick={resetBosses} className="admin-panel__danger-btn">🗑 Reset wszystkich</button>
                            </div>

                            <h3>Lochy</h3>
                            <FieldRow label="Loch">
                                <select value={dungeonId} onChange={(e) => setDungeonId(e.target.value)}>
                                    {ALL_DUNGEONS.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {d.name_pl ?? d.id} (Lv{d.level ?? '?'})
                                        </option>
                                    ))}
                                </select>
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={markDungeonCleared}>Oznacz pokonany</button>
                                <button onClick={refundDungeonAttempts}>Refund attempts</button>
                                <button onClick={resetDungeons} className="admin-panel__danger-btn">🗑 Reset wszystkich</button>
                            </div>

                            <h3>Wszystkie daily attempts</h3>
                            <FieldRow label="Refund all">
                                <button onClick={clearAllDailyAttempts}>Refund wszystkie</button>
                            </FieldRow>

                            <h3>Transformy</h3>
                            <FieldRow label="Tier (1-12)">
                                <input type="number" value={transformTier} onChange={(e) => setTransformTier(e.target.value)} min={1} max={12} />
                                <button onClick={unlockTransformTier}>Odblokuj tier</button>
                            </FieldRow>
                            <div className="admin-panel__grid">
                                <button onClick={unlockAllTransforms}>Wszystkie tiery ON</button>
                                <button onClick={abandonTransformQuest}>Porzuć aktywny quest</button>
                                <button onClick={resetTransforms} className="admin-panel__danger-btn">🗑 Reset transformów</button>
                            </div>
                        </section>
                    )}

                    {tab === 'social' && (
                        <section className="admin-panel__section">
                            <h3>Arena</h3>
                            <FieldRow label="Kills / Deaths">
                                <input type="number" value={arenaKills} onChange={(e) => setArenaKills(e.target.value)} placeholder="K" />
                                <input type="number" value={arenaDeaths} onChange={(e) => setArenaDeaths(e.target.value)} placeholder="D" />
                            </FieldRow>
                            <FieldRow label="Liga">
                                <select value={arenaLeague} onChange={(e) => setArenaLeague(e.target.value as typeof ARENA_LEAGUES[number])}>
                                    {ARENA_LEAGUES.map((l) => <option key={l} value={l}>{l}</option>)}
                                </select>
                            </FieldRow>
                            <FieldRow label="League Points">
                                <input type="number" value={arenaLP} onChange={(e) => setArenaLP(e.target.value)} min={0} />
                                <button onClick={setArenaStats}>Ustaw wszystko</button>
                            </FieldRow>
                            <FieldRow label="Akcje">
                                <button onClick={clearArenaState}>Wyczyść currentArena</button>
                            </FieldRow>

                            <h3>Party</h3>
                            <FieldRow label="Akcje">
                                <button onClick={leaveActiveParty}>Opuść party</button>
                            </FieldRow>

                            <h3>Market</h3>
                            <FieldRow label="Akcje">
                                <button onClick={clearMarketState}>Wyczyść powiadomienia o sprzedażach</button>
                            </FieldRow>
                        </section>
                    )}

                    {tab === 'system' && (
                        <section className="admin-panel__section">
                            <h3>Tryb gry</h3>
                            <FieldRow label={`Obecnie: ${playMode}`}>
                                <button onClick={() => void toggleMode()}>Przełącz tryb</button>
                                <button onClick={clearOfflineSnapshot}>Wyczyść snapshot</button>
                            </FieldRow>

                            <h3>Sync</h3>
                            <FieldRow label="Cloud sync">
                                <button onClick={() => void forceSync()}>Force save → Supabase</button>
                            </FieldRow>

                            <h3>Walka / Combat</h3>
                            <FieldRow label="Combat session">
                                <button onClick={clearCombatSession}>Wyczyść aktywną walkę</button>
                            </FieldRow>

                            <h3>Offline hunt</h3>
                            <FieldRow label="Akcje">
                                <button onClick={stopOfflineHunt}>Stop offline hunt</button>
                            </FieldRow>

                            <h3>Buffy</h3>
                            <FieldRow label="Buff id (free-text)">
                                <input type="text" value={buffId} onChange={(e) => setBuffId(e.target.value)} placeholder="hp_boost_pct" />
                            </FieldRow>
                            <FieldRow label="Czas (sek)">
                                <input type="number" value={buffDuration} onChange={(e) => setBuffDuration(e.target.value)} min={60} />
                                <button onClick={addBuff}>Dodaj buff</button>
                            </FieldRow>
                            <FieldRow label="Akcje">
                                <button onClick={clearAllBuffs} className="admin-panel__danger-btn">🗑 Wyczyść wszystkie buffy</button>
                            </FieldRow>

                            <h3>Death overlay</h3>
                            <div className="admin-panel__grid">
                                <button onClick={triggerFakeDeath}>Pokaż popup śmierci (fake)</button>
                                <button onClick={clearDeathEvent}>Wyłącz popup</button>
                            </div>
                        </section>
                    )}

                    {tab === 'nuke' && (
                        <section className="admin-panel__section">
                            <h3>Strefa wybuchu</h3>
                            <p className="admin-panel__warn">
                                Czyści: skille, taski, questy, daily, lochy, bossy,
                                transformy, mastery, buffy. NIE rusza inventory ani postaci.
                                Kliknij 2× w 3 s żeby potwierdzić.
                            </p>
                            <button
                                onClick={nuke}
                                className={`admin-panel__nuke${confirmNuke ? ' admin-panel__nuke--confirm' : ''}`}
                            >
                                {confirmNuke ? '⚠️ Kliknij ponownie aby potwierdzić' : '💀 Reset wszystkiego'}
                            </button>
                        </section>
                    )}
                </div>

                {toast && <div className="admin-panel__toast">{toast}</div>}
            </div>
        </div>
    );

    // 2026-05-21 layout fix: render through a portal to document.body so
    // the AvatarMenu's backdrop-filter (which creates a new containing
    // block for `position: fixed`) can no longer clip us.
    return createPortal(panelNode, document.body);
};

interface ITabBtnProps {
    current: TTab;
    value: TTab;
    label: string;
    onClick: (v: TTab) => void;
}
const TabBtn = ({ current, value, label, onClick }: ITabBtnProps) => (
    <button
        type="button"
        className={`admin-panel__tab${current === value ? ' admin-panel__tab--active' : ''}`}
        onClick={() => onClick(value)}
    >
        {label}
    </button>
);

interface IFieldRowProps { label: string; children: React.ReactNode; }
const FieldRow = ({ label, children }: IFieldRowProps) => (
    <label className="admin-panel__row">
        <span className="admin-panel__row-label">{label}</span>
        <span className="admin-panel__row-controls">{children}</span>
    </label>
);

export default AdminPanel;
