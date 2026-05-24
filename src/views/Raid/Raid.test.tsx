import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Raid view — 8-wave boss train, party-only. 4358 lines. Phases:
 * 'lobby' | 'fighting' | 'victory' | 'wipe'. Mount has multiple gate
 * screens before showing the actual raid list:
 *   • noParty           → "Potrzebujesz Party"
 *   • partyTooSmall     → "Za mało osób" (less than 2 humans)
 *   • notLeader         → "Tylko lider"
 *   • showList          → the actual raid hub
 *
 * Coverage: render + each of the four gates + the leader's list view.
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

vi.mock('../../hooks/useLevelUpRefill', () => ({
    useLevelUpRefill: vi.fn(),
}));

vi.mock('../../hooks/usePartyReadyCheck', () => ({
    requestPartyCombatStart: vi.fn(),
    registerGoReplicator: vi.fn(),
    triggerPartyCombatGo: vi.fn(),
}));

vi.mock('../../api/v1/deathsApi', () => ({
    deathsApi: {
        createDeath: vi.fn().mockResolvedValue(null),
        getMyDeaths: vi.fn().mockResolvedValue([]),
        getRecentDeaths: vi.fn().mockResolvedValue([]),
    },
}));

import Raid from './Raid';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useRaidStore } from '../../stores/raidStore';
import { useTransformStore } from '../../stores/transformStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { usePartyCombatSyncStore } from '../../stores/partyCombatSyncStore';
import { usePartyReadyCheckStore } from '../../stores/partyReadyCheckStore';
import { useTaskStore } from '../../stores/taskStore';
import { useQuestStore } from '../../stores/questStore';
import { useDailyQuestStore } from '../../stores/dailyQuestStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useDeathStore } from '../../stores/deathStore';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'leader-1',
    user_id: 'user-1',
    name: 'Leader',
    class: 'Knight',
    level: 50,
    xp: 0,
    hp: 500, max_hp: 500, mp: 200, max_mp: 200,
    attack: 80, defense: 60, attack_speed: 2.0,
    crit_chance: 5, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 50,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

// Helper: build a 2-human party where the test character is the leader.
const makeLeaderParty = (characterId: string) => ({
    id: 'party-1',
    leaderId: characterId,
    members: [
        { id: characterId, name: 'Leader', class: 'Knight', level: 50, isBot: false, hp: 500, maxHp: 500, mp: 200, maxMp: 200 },
        { id: 'member-2', name: 'Ally', class: 'Mage', level: 48, isBot: false, hp: 300, maxHp: 300, mp: 400, maxMp: 400 },
    ],
});

// Helper: 2-human party where the test character is NOT the leader.
const makeNonLeaderParty = (characterId: string) => ({
    id: 'party-1',
    leaderId: 'other-leader',
    members: [
        { id: 'other-leader', name: 'BossMan', class: 'Knight', level: 60, isBot: false, hp: 600, maxHp: 600, mp: 200, maxMp: 200 },
        { id: characterId, name: 'Member', class: 'Mage', level: 50, isBot: false, hp: 300, maxHp: 300, mp: 400, maxMp: 400 },
    ],
});

const renderRaid = () =>
    render(
        <MemoryRouter>
            <Raid />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({ phase: 'idle' });
    useRaidStore.setState({ attempts: {}, activeRaidId: null });
    useTransformStore.setState({ completedTransforms: [] });
    useSettingsStore.setState({
        raidFilterAvailableOnly: false,
        raidFilterMinLevel: 0,
        raidFilterSortDesc: false,
        skillMode: 'auto',
        autoPotionHpEnabled: false,
        autoPotionMpEnabled: false,
    });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({ equipment: {}, consumables: [], items: [] });
    usePartyStore.setState({ party: null });
    usePartyPresenceStore.setState({ byMember: {} });
    usePartyCombatSyncStore.setState({});
    usePartyReadyCheckStore.setState({});
    useTaskStore.setState({ activeTasks: [] });
    useQuestStore.setState({ activeQuests: [] });
    useDailyQuestStore.setState({ activeQuests: [] });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useNecroSummonStore.setState({ summons: {} });
    useDeathStore.setState({ recentDeaths: [], lastDeath: null });
});

afterEach(() => {
    cleanup();
});

describe('Raid — smoke', () => {
    it('renders without crashing (no party → gate screen)', () => {
        const { container } = renderRaid();
        expect(container.querySelector('.raid')).not.toBeNull();
    });

    it('handles null character gracefully', () => {
        useCharacterStore.setState({ character: null });
        // Raid uses character with optional chaining in most places — should
        // not crash even when null on mount.
        const { container } = renderRaid();
        // The component may render nothing or a gate; either way no throw.
        expect(container).toBeTruthy();
    });
});

describe('Raid — gating screens', () => {
    it('shows the noParty gate when party is null', () => {
        usePartyStore.setState({ party: null });
        renderRaid();
        // "Potrzebujesz Party" headline gates raids without a party at all.
        expect(screen.getByText(/Potrzebujesz Party/i)).toBeTruthy();
    });

    it('shows the partyTooSmall gate when party has < 2 members', () => {
        usePartyStore.setState({
            party: {
                id: 'party-1',
                leaderId: 'char-1',
                members: [{ id: 'char-1', name: 'Solo', class: 'Knight', level: 50, isBot: false, hp: 500, maxHp: 500, mp: 200, maxMp: 200 }],
            },
        });
        useCharacterStore.setState({ character: makeChar({ id: 'char-1' }) });
        renderRaid();
        expect(screen.getByText(/Za mało osób/i)).toBeTruthy();
    });

    it('shows the notLeader gate when the player is in a 2+ human party but is not the leader', () => {
        useCharacterStore.setState({ character: makeChar({ id: 'member-x' }) });
        usePartyStore.setState({ party: makeNonLeaderParty('member-x') });
        renderRaid();
        expect(screen.getByText(/Tylko lider/i)).toBeTruthy();
    });

    it('shows the actual raid list when leader is in a valid 2+ human party', () => {
        const charId = 'leader-1';
        useCharacterStore.setState({ character: makeChar({ id: charId }) });
        usePartyStore.setState({ party: makeLeaderParty(charId) });
        const { container } = renderRaid();
        // Leader list = .raid__panel mount, filter bar present.
        expect(container.querySelector('.raid__panel')).not.toBeNull();
        expect(container.querySelector('.raid__hub-filters')).not.toBeNull();
    });
});

describe('Raid — filter chrome (leader list)', () => {
    beforeEach(() => {
        const charId = 'leader-1';
        useCharacterStore.setState({ character: makeChar({ id: charId }) });
        usePartyStore.setState({ party: makeLeaderParty(charId) });
    });

    it('renders the three filter controls', () => {
        const { container } = renderRaid();
        const toggles = container.querySelectorAll('.raid__filter-toggle');
        expect(toggles.length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('.raid__filter-bar')).not.toBeNull();
    });

    it('reflects raidFilterAvailableOnly=true via the --active modifier', () => {
        useSettingsStore.setState({ raidFilterAvailableOnly: true });
        const { container } = renderRaid();
        const toggle = container.querySelector('.raid__filter-toggle');
        expect(toggle?.className).toContain('raid__filter-toggle--active');
    });

    it('reflects raidFilterSortDesc=true on the second toggle', () => {
        useSettingsStore.setState({ raidFilterSortDesc: true });
        const { container } = renderRaid();
        const toggles = container.querySelectorAll('.raid__filter-toggle');
        expect(toggles[1]?.className).toContain('raid__filter-toggle--active');
    });
});

describe('Raid — class variants', () => {
    beforeEach(() => {
        const charId = 'leader-1';
        usePartyStore.setState({ party: makeLeaderParty(charId) });
    });

    it('renders for a Mage leader', () => {
        useCharacterStore.setState({ character: makeChar({ id: 'leader-1', class: 'Mage' }) });
        const { container } = renderRaid();
        expect(container.querySelector('.raid')).not.toBeNull();
    });

    it('renders for a Cleric leader', () => {
        useCharacterStore.setState({ character: makeChar({ id: 'leader-1', class: 'Cleric' }) });
        const { container } = renderRaid();
        expect(container.querySelector('.raid')).not.toBeNull();
    });
});

// TODO: phase==='fighting' / 'victory' / 'wipe' require driving
//       `startRaid` + the per-wave boss train + member damage shipping.
//       That's exclusively Playwright territory (requires real Supabase
//       Realtime channels for cross-client sync). Raid combat mechanics
//       (boss generation, completion rolls, drop tiers) are covered in
//       `raidSystem` unit tests.
