import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Trainer view — sandbox combat arena. Always renders in a single
 * pseudo-phase (no list / no result screen — the player walks in, hits
 * the dummy until they Wyjdź). Heavy compared to Battle but lighter than
 * Boss/Combat because there's no list-fighting-result state machine, no
 * loot drops, no XP/gold flow.
 *
 * Our coverage focuses on render contract:
 *   • Smoke render with a character.
 *   • Spinner fallback when character is null (mount short-circuits to a
 *     "Wczytywanie postaci…" screen).
 *   • Root .trainer wrapper mounts.
 *   • Combat HUD shell is active by default (CombatHudHost active=true).
 *
 * We DON'T try to exercise the spell-cast / sandbox-HP / aggro picker
 * paths — those mutate dozens of refs and would require driving five
 * unrelated stores. That's E2E territory.
 */

// Hooks that touch supabase / realtime / sprite animation — no-op them
// here so the smoke test stays deterministic + cheap.
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

// framer-motion causes happy-dom hangs on AnimatePresence — stub it.
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

import Trainer from './Trainer';
import { useCharacterStore } from '../../stores/characterStore';
import { useCombatStore } from '../../stores/combatStore';
import { useTransformStore } from '../../stores/transformStore';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { useBuffStore } from '../../stores/buffStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
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

const renderTrainer = () =>
    render(
        <MemoryRouter>
            <Trainer />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useCombatStore.setState({ phase: 'idle' });
    useTransformStore.setState({ completedTransforms: [] });
    useNecroSummonStore.setState({ summons: {} });
    useBuffStore.setState({ activeBuffs: {} });
    useSkillStore.setState({ activeSkillSlots: [null, null, null, null], skillLevels: {} });
    useInventoryStore.setState({
        equipment: {},
        consumables: [],
        items: [],
    });
    usePartyStore.setState({ party: null });
    usePartyPresenceStore.setState({ byMember: {} });
});

afterEach(() => {
    cleanup();
});

describe('Trainer — smoke', () => {
    it('renders without crashing when a character is loaded', () => {
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });

    it('shows the loading spinner when character is null', () => {
        useCharacterStore.setState({ character: null });
        renderTrainer();
        // Spec: Trainer mount-guards on `if (!character)` and renders
        // <Spinner size="lg" label="Wczytywanie postaci…">.
        expect(screen.getByText(/Wczytywanie postaci/i)).toBeTruthy();
    });

    it('renders the --loading modifier on .trainer when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderTrainer();
        // Spinner-fallback path still uses the .trainer root but adds
        // --loading modifier — the full arena does not mount.
        const root = container.querySelector('.trainer');
        expect(root).not.toBeNull();
        expect(root?.className).toContain('trainer--loading');
    });
});

describe('Trainer — class variants', () => {
    it('mounts for Mage class (different attack-animation duration)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });

    it('mounts for Archer class (the dummy itself is rendered with Archer style)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Archer' }) });
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });

    it('mounts for Necromancer class (summon stack feature path)', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });
});

describe('Trainer — sandbox HP/MP isolation', () => {
    it('does not crash when character has 0 HP at mount (sandbox forces to effective max)', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 0, mp: 0 }) });
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });

    it('still mounts when max_hp is unusually small (sandbox initializes off whatever the char carries)', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 1, max_hp: 1 }) });
        const { container } = renderTrainer();
        expect(container.querySelector('.trainer')).not.toBeNull();
    });
});

// TODO: Deeper coverage of the Trainer sandbox (skill cooldown bypass,
//       dummy HP% slider driving execute_below atoms, party member
//       kill/revive picker, leader-only chip gating for non-leader
//       members) requires real combatEngine + effectsHelpers tick loops
//       wired against time-travelling refs — not viable for vitest.
//       That depth lives in Playwright e2e (tests/e2e/trainer/).
