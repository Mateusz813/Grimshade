import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Town view — game hub (~775 lines). 7-tile nav grid (Offline trening,
 * Depozyt, Market, Potwory, Odpoczynek, Rankingi, Śmierci), character
 * card with HP/MP/XP bars, party strip, combat indicator, rest overlay,
 * tile auto-pulse interval.
 *
 * Coverage:
 *   - Smoke: root mounts with character.
 *   - Character card mounts when character exists, hides otherwise.
 *   - 7 nav tiles render in fixed order.
 *   - Offline mode locks Market / Rankingi / Śmierci (disabled + classes).
 *   - Online mode keeps those tiles enabled.
 *   - Tile click navigates (Depozyt -> /deposit etc.).
 *   - Rest tile disabled when HP + MP already full.
 *   - Combat indicator strip appears when phase === 'fighting'.
 *   - Party strip — empty solo + with party variants.
 *
 * Mocks: framer-motion not needed here (no AnimatePresence on Town). The
 * combat engine's `stopCombat` is called from the combat strip — stub it.
 */

vi.mock('../../systems/combatEngine', async () => {
    const actual = await vi.importActual<typeof import('../../systems/combatEngine')>(
        '../../systems/combatEngine',
    );
    return {
        ...actual,
        stopCombat: vi.fn(),
    };
});

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

// useOfflineTrainingResume hook reaches into the skill store + side-effect
// timers — stub the whole thing.
vi.mock('../../hooks/useOfflineTrainingResume', () => ({
    useOfflineTrainingResume: () => ({ reward: null, clearReward: vi.fn() }),
}));

import Town from './Town';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { useGuildStore } from '../../stores/guildStore';
import { useGuildTagsStore } from '../../stores/guildTagsStore';
import { useCombatStore } from '../../stores/combatStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
import { useConnectivityStore } from '../../stores/connectivityStore';
import { useMarketStore } from '../../stores/marketStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { EMPTY_EQUIPMENT } from '../../systems/itemSystem';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 100,
    hp: 80, max_hp: 100, mp: 20, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderTown = () =>
    render(
        <MemoryRouter>
            <Town />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockClear();
    useCharacterStore.setState({ character: makeChar() });
    useInventoryStore.setState({ equipment: { ...EMPTY_EQUIPMENT } });
    useSkillStore.setState({ skillLevels: {} });
    useTransformStore.setState({ completedTransforms: [] });
    useGuildStore.setState({ guild: null });
    useGuildTagsStore.setState({});
    useCombatStore.setState({
        phase: 'idle',
        monster: null,
        monsterRarity: 'normal',
        sessionKills: {},
        sessionXpPerHour: 0,
    });
    useOfflineHuntStore.setState({
        isActive: false,
        startedAt: null,
        targetMonster: null,
        trainedSkillId: null,
    });
    useConnectivityStore.setState({ mode: 'online' });
    useMarketStore.setState({
        saleNotifications: [],
        fetchSaleNotifications: vi.fn() as never,
    });
    usePartyStore.setState({ party: null });
    usePartyPresenceStore.setState({ byMember: {} });
});

afterEach(() => {
    cleanup();
});

describe('Town — smoke', () => {
    it('renders the root .town container', () => {
        const { container } = renderTown();
        expect(container.querySelector('.town')).not.toBeNull();
    });

    it('mounts the character card when a character is loaded', () => {
        const { container } = renderTown();
        expect(container.querySelector('.town__character-card')).not.toBeNull();
        expect(container.textContent).toContain('Hero');
        expect(container.textContent).toContain('Poziom 5');
    });

    it('omits the character card when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderTown();
        expect(container.querySelector('.town')).not.toBeNull();
        expect(container.querySelector('.town__character-card')).toBeNull();
    });
});

describe('Town — nav tiles', () => {
    it('renders all 7 navigation tiles', () => {
        const { container } = renderTown();
        const tiles = container.querySelectorAll('.town__nav-btn');
        expect(tiles.length).toBe(7);
    });

    it('renders tile labels in expected order: Offline, Depozyt, Market, Potwory, Odpoczynek, Rankingi, Śmierci', () => {
        const { container } = renderTown();
        const labels = Array.from(container.querySelectorAll('.town__nav-btn-label'))
            .map((el) => el.textContent ?? '');
        expect(labels[0]).toMatch(/Offline/);
        expect(labels[1]).toMatch(/Depozyt/);
        expect(labels[2]).toMatch(/Market/);
        expect(labels[3]).toMatch(/Potwory/);
        // [4] alternates between 'Odpoczynek' and 'Regeneracja...'; rest tile here.
        expect(labels[4]).toMatch(/Odpoczynek|Regeneracja/);
        expect(labels[5]).toMatch(/Rankingi/);
        expect(labels[6]).toMatch(/Śmierci/);
    });
});

describe('Town — offline mode locks', () => {
    it('disables Market / Rankingi / Śmierci tiles when mode === "offline"', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        const { container } = renderTown();
        const market = container.querySelector('.town__nav-tile--market') as HTMLButtonElement;
        const ranks = container.querySelector('.town__nav-tile--leaderboard') as HTMLButtonElement;
        const deaths = container.querySelector('.town__nav-tile--deaths') as HTMLButtonElement;
        expect(market.disabled).toBe(true);
        expect(ranks.disabled).toBe(true);
        expect(deaths.disabled).toBe(true);
        expect(market.className).toContain('town__nav-btn--offline-locked');
        expect(ranks.className).toContain('town__nav-btn--offline-locked');
        expect(deaths.className).toContain('town__nav-btn--offline-locked');
    });

    it('keeps Market / Rankingi / Śmierci tiles enabled when online', () => {
        useConnectivityStore.setState({ mode: 'online' });
        const { container } = renderTown();
        const market = container.querySelector('.town__nav-tile--market') as HTMLButtonElement;
        const ranks = container.querySelector('.town__nav-tile--leaderboard') as HTMLButtonElement;
        const deaths = container.querySelector('.town__nav-tile--deaths') as HTMLButtonElement;
        expect(market.disabled).toBe(false);
        expect(ranks.disabled).toBe(false);
        expect(deaths.disabled).toBe(false);
    });

    it('leaves Depozyt + Potwory + Offline Trening enabled in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        const { container } = renderTown();
        const deposit = container.querySelector('.town__nav-tile--deposit') as HTMLButtonElement;
        const monsters = container.querySelector('.town__nav-tile--monsters') as HTMLButtonElement;
        const offline = container.querySelector('.town__nav-tile--offline') as HTMLButtonElement;
        expect(deposit.disabled).toBe(false);
        expect(monsters.disabled).toBe(false);
        expect(offline.disabled).toBe(false);
    });
});

describe('Town — tile navigation', () => {
    it('navigates to /deposit on Depozyt click', () => {
        const { container } = renderTown();
        const tile = container.querySelector('.town__nav-tile--deposit') as HTMLButtonElement;
        fireEvent.click(tile);
        expect(navigateMock).toHaveBeenCalledWith('/deposit');
    });

    it('navigates to /monsters on Potwory click', () => {
        const { container } = renderTown();
        const tile = container.querySelector('.town__nav-tile--monsters') as HTMLButtonElement;
        fireEvent.click(tile);
        expect(navigateMock).toHaveBeenCalledWith('/monsters');
    });

    it('navigates to /offline-hunt on Offline tile click', () => {
        const { container } = renderTown();
        const tile = container.querySelector('.town__nav-tile--offline') as HTMLButtonElement;
        fireEvent.click(tile);
        expect(navigateMock).toHaveBeenCalledWith('/offline-hunt');
    });

    it('navigates to /market when online', () => {
        const { container } = renderTown();
        const tile = container.querySelector('.town__nav-tile--market') as HTMLButtonElement;
        fireEvent.click(tile);
        expect(navigateMock).toHaveBeenCalledWith('/market');
    });
});

describe('Town — rest tile', () => {
    it('is enabled when player has missing HP or MP', () => {
        // makeChar default has hp 80/100, mp 20/30 -> needs rest.
        const { container } = renderTown();
        const rest = container.querySelector('.town__nav-tile--rest') as HTMLButtonElement;
        expect(rest.disabled).toBe(false);
    });

    it('is disabled when HP + MP are already at max (no need to rest)', () => {
        useCharacterStore.setState({ character: makeChar({ hp: 100, mp: 30 }) });
        const { container } = renderTown();
        const rest = container.querySelector('.town__nav-tile--rest') as HTMLButtonElement;
        expect(rest.disabled).toBe(true);
        expect(rest.className).toContain('town__nav-btn--rest-full');
    });

    it('is disabled while combat is active (blocked reason)', () => {
        useCombatStore.setState({ phase: 'fighting' });
        const { container } = renderTown();
        const rest = container.querySelector('.town__nav-tile--rest') as HTMLButtonElement;
        expect(rest.disabled).toBe(true);
        expect(rest.className).toContain('town__nav-btn--blocked');
    });
});

describe('Town — combat indicator strip', () => {
    it('renders the strip when phase === "fighting" with a monster', () => {
        useCombatStore.setState({
            phase: 'fighting',
            monster: { id: 'm', name_pl: 'Goblin', level: 3, sprite: 'alien-monster' } as never,
            monsterRarity: 'normal',
            sessionKills: { goblin: 5 },
            sessionXpPerHour: 1200,
        });
        const { container } = renderTown();
        const strip = container.querySelector('.town__combat-strip');
        expect(strip).not.toBeNull();
        expect(container.textContent).toContain('Goblin');
    });

    it('does NOT render the strip in idle phase', () => {
        const { container } = renderTown();
        expect(container.querySelector('.town__combat-strip')).toBeNull();
    });
});

describe('Town — party strip', () => {
    it('shows the "solo" empty strip when no party exists', () => {
        const { container } = renderTown();
        const empty = container.querySelector('.town__party-strip--empty');
        expect(empty).not.toBeNull();
        expect(container.textContent).toContain('Solo');
    });

    it('shows "Tryb offline — party niedostępne" copy in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        const { container } = renderTown();
        expect(container.textContent).toContain('Tryb offline');
        expect(container.textContent).toContain('party niedostępne');
    });

    it('hides party create + goto buttons in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        const { container } = renderTown();
        expect(container.querySelector('.town__party-strip-create')).toBeNull();
        expect(container.querySelector('.town__party-strip-goto')).toBeNull();
    });

    it('renders the expanded party strip when party exists', () => {
        usePartyStore.setState({
            party: {
                id: 'p1',
                name: 'Test party',
                description: '',
                isPublic: true,
                password: null,
                leaderId: 'char-1',
                createdAt: new Date().toISOString(),
                members: [
                    { id: 'char-1', name: 'Hero', class: 'Knight', level: 5, hp: 1, maxHp: 1, isOnline: true },
                ],
            } as never,
        });
        const { container } = renderTown();
        const strip = container.querySelector('.town__party-strip');
        expect(strip).not.toBeNull();
        expect(strip!.className).not.toContain('town__party-strip--empty');
    });
});

describe('Town — class variants', () => {
    it('renders for Mage class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderTown();
        expect(container.querySelector('.town')).not.toBeNull();
        // Class is rendered as an emoji icon, not the class name text — the
        // Mage glyph is :crystal-ball: (see CLASS_ICONS in Town.tsx). It now renders via
        // <GameIcon> as an inline <svg>, so query the svg by its data-icon attribute.
        expect(
            container.querySelector('.town__char-class svg.game-icon')?.getAttribute('data-icon'),
        ).toBe('crystal-ball');
    });

    it('renders for Necromancer class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Necromancer' }) });
        const { container } = renderTown();
        expect(container.querySelector('.town')).not.toBeNull();
    });
});

// TODO: Cover Odpoczynek (Rest) full timer flow (10s setTimeout setRestResult).
//       happy-dom + vi.useFakeTimers can drive it but the heal callback walks
//       useCharacterStore.getState() — would need a more involved store
//       fixture. Skipped here; the rest-system is unit-tested elsewhere.
// TODO: Cover offline-hunt active-state tile swap (shows MonsterSprite + timer
//       label instead of static art) — requires seeding an active hunt with a
//       monster + ticking the 1s interval. The mechanic itself has dedicated
//       coverage in offlineHuntStore.test.ts + offlineHuntSystem.test.ts.
// TODO: Stat-points-to-spend button (visible when character.stat_points > 0)
//       — simple branch but already implicitly covered when stat_points = 0.
