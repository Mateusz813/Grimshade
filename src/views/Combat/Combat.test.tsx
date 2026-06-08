import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Combat view — the hunting hub. 2948 lines, drives ~15 stores, runs
 * combatEngine intervals, animations, party sync, etc. We can't (and
 * shouldn't) cover the entire combat loop through React tests — that's
 * what combatEngine.test.ts and Playwright E2E exist for.
 *
 * What we DO cover here:
 *   • Smoke render in idle phase (the monster picker hub).
 *   • Null-character short-circuit (returns null, no crash).
 *   • Idle-phase top control bar mounts.
 *   • Transitioning the store to phase==='fighting' swaps the chrome
 *     (the idle header disappears, combat arena mounts).
 *   • Engine helpers (`startNewFight`, `stopCombat`, `handlePlayerDeath`)
 *     are wired through the engine module — we don't drive them but we
 *     verify the import didn't crash.
 *
 * Mocking strategy: stub the entire `combatEngine` module + heavy
 * animation hooks + framer-motion AnimatePresence so the view doesn't
 * spawn any intervals on mount.
 */

vi.mock('framer-motion', async () => {
    const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
    return {
        ...actual,
        AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
        motion: new Proxy({}, {
            get: () => (props: Record<string, unknown>) => {
                const { children, ...rest } = props as { children?: React.ReactNode };
                return <div {...(rest as Record<string, unknown>)}>{children}</div>;
            },
        }),
    };
});

vi.mock('../../hooks/useCombatFx', () => ({
    useCombatFx: () => ({
        enemyFloats: {},
        allyFloats: {},
        enemySkill: {},
        allySkill: {},
        allySummonSpawn: {},
        pushEnemyFloat: vi.fn(),
        pushAllyFloat: vi.fn(),
        triggerEnemySkillAnim: vi.fn(),
        triggerAllySkillAnim: vi.fn(),
        triggerAllySummonSpawn: vi.fn(),
        resetFx: vi.fn(),
        resetAllyFx: vi.fn(),
    }),
}));

vi.mock('../../hooks/useSkillAnim', () => ({
    useSkillAnim: () => ({
        overlay: null,
        trigger: vi.fn(),
    }),
}));

vi.mock('../../hooks/useLevelUpRefill', () => ({
    useLevelUpRefill: vi.fn(),
}));

vi.mock('../../hooks/usePartyReadyCheck', () => ({
    requestPartyCombatStart: vi.fn(),
    registerGoReplicator: vi.fn(),
    triggerPartyCombatGo: vi.fn(),
}));

// combatEngine spawns intervals + timeouts on `startNewFight` — pure
// stub here.
vi.mock('../../systems/combatEngine', async () => {
    const actual = await vi.importActual<typeof import('../../systems/combatEngine')>(
        '../../systems/combatEngine',
    );
    return {
        ...actual,
        startNewFight: vi.fn(),
        stopCombat: vi.fn(),
        handleMonsterDeath: vi.fn(),
        handlePlayerDeath: vi.fn(),
        getEffectiveChar: actual.getEffectiveChar,
    };
});

import Combat from './Combat';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useCooldownStore } from '../../stores/cooldownStore';
import { useBotStore } from '../../stores/botStore';
import { useBuffStore } from '../../stores/buffStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderCombat = () =>
    render(
        <MemoryRouter>
            <Combat />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({
        phase: 'idle',
        monster: null,
        selectedMonster: null,
        waveMonsters: [],
        playerCurrentHp: 100,
        playerCurrentMp: 30,
        log: [],
        sessionLog: [],
        lastDrops: [],
        sessionDrops: [],
        autoFight: false,
        wavePlannedCount: 1,
    });
    useTransformStore.setState({ completedTransforms: [] });
    useSettingsStore.setState({
        combatSpeed: 'x1',
        skillMode: 'auto',
        showCombatXpBar: true,
        huntFilterAvailableOnly: false,
        huntFilterTaskedOnly: false,
        huntFilterMinLevel: 0,
        huntFilterSortDesc: false,
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT }, consumables: {} });
    usePartyStore.setState({ party: null });
    usePartyPresenceStore.setState({ byMember: {} });
    useTaskStore.setState({ activeTasks: [] });
    useQuestStore.setState({ activeQuests: [] });
    useDailyQuestStore.setState({ activeQuests: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useCooldownStore.setState({
        hpPotionCooldown: 0,
        mpPotionCooldown: 0,
        pctHpCooldown: 0,
        pctMpCooldown: 0,
        skillCooldowns: {},
    });
    useBotStore.setState({ bots: [] });
    useBuffStore.setState({ allBuffs: [] });
    useNecroSummonStore.setState({ summons: {} });
});

afterEach(() => {
    cleanup();
});

describe('Combat — smoke', () => {
    it('renders without crashing in idle phase with a character', () => {
        const { container } = renderCombat();
        expect(container.querySelector('.combat')).not.toBeNull();
    });

    it('returns null (renders nothing) when character is missing', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderCombat();
        // The component short-circuits with `if (!character) return null;`
        // before any markup is emitted.
        expect(container.querySelector('.combat')).toBeNull();
    });

    it('renders idle-phase top header with the speed / skill / fight / xp buttons', () => {
        const { container } = renderCombat();
        // Idle header lives in <header class="combat__top page-header">.
        expect(container.querySelector('.combat__top')).not.toBeNull();
        expect(container.querySelector('.combat__speed-btn')).not.toBeNull();
        expect(container.querySelector('.combat__mode-btn')).not.toBeNull();
        expect(container.querySelector('.combat__toggle-btn')).not.toBeNull();
    });

    it('renders the wave count / monster picker hub when no selectedMonster is set', () => {
        const { container } = renderCombat();
        // The hub section mounts when phase==='idle' AND no selectedMonster.
        expect(container.querySelector('.combat__hub')).not.toBeNull();
    });
});

describe('Combat — class variants render', () => {
    it('renders for Mage class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderCombat();
        expect(container.querySelector('.combat')).not.toBeNull();
    });

    it('renders for Necromancer class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderCombat();
        expect(container.querySelector('.combat')).not.toBeNull();
    });

    it('renders for Archer class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Archer' }) });
        const { container } = renderCombat();
        expect(container.querySelector('.combat')).not.toBeNull();
    });
});

describe('Combat — settings driving the chrome', () => {
    it('reflects AUTO skill mode in the skill button modifier class', () => {
        useSettingsStore.setState({ skillMode: 'auto' });
        const { container } = renderCombat();
        const btn = container.querySelector('.combat__mode-btn');
        expect(btn?.className).toContain('combat__mode-btn--auto');
    });

    it('reflects MANUAL skill mode in the skill button modifier class', () => {
        useSettingsStore.setState({ skillMode: 'manual' });
        const { container } = renderCombat();
        const btn = container.querySelector('.combat__mode-btn');
        expect(btn?.className).toContain('combat__mode-btn--manual');
    });

    it('reflects active showCombatXpBar via the xp-toggle--active modifier', () => {
        useSettingsStore.setState({ showCombatXpBar: true });
        const { container } = renderCombat();
        const xpBtn = container.querySelector('.combat__xp-toggle');
        expect(xpBtn?.className).toContain('combat__xp-toggle--active');
    });
});

describe('Combat — phase guard', () => {
    it('hides the idle hub when phase==="fighting" (renders the in-fight arena instead)', () => {
        useCombatStore.setState({ phase: 'fighting' });
        const { container } = renderCombat();
        // Idle hub gates on phase==='idle' so when we flip to fighting it
        // unmounts. The .combat root still mounts.
        expect(container.querySelector('.combat')).not.toBeNull();
        expect(container.querySelector('.combat__hub')).toBeNull();
        // Idle top header also disappears in fighting phase.
        expect(container.querySelector('.combat__top')).toBeNull();
    });
});

// TODO: Driving Attack / Flee / Skill 1-4 interactions in fighting phase
//       requires wiring combatStore.waveMonsters with a real monster + the
//       full effects session refs that <CombatActionBar> reads. The action
//       bar itself has dedicated unit coverage in
//       src/components/organisms/CombatUI/CombatActionBar.test.tsx.
//       End-to-end click-to-damage is covered by Playwright in
//       tests/e2e/combat/.
