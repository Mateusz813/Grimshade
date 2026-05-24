import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

/**
 * CombatLogsModal — popup showing the uncapped session log with 5 filter
 * toggles (Me / Allies / Monster / Loot / Other). Translates raw skill
 * IDs through skillBuffs.getSkillDef which we stub.
 */
vi.mock('../../../systems/skillBuffs', () => ({
    getSkillDef: (id: string) => {
        const map: Record<string, { name_pl?: string; name_en?: string }> = {
            poisoned_arrow: { name_pl: 'Zatruta Strzała' },
        };
        return map[id];
    },
}));

import CombatLogsModal from './CombatLogsModal';
import { useCombatStore, type ICombatLogEntry } from '../../../stores/combatStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 5,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 10, defense: 5, attack_speed: 2,
    crit_chance: 0, crit_damage: 100, magic_level: 0,
    hp_regen: 0, mp_regen: 0, gold: 0,
    stat_points: 0, highest_level: 5,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

let _id = 0;
const makeLog = (text: string, type: ICombatLogEntry['type']): ICombatLogEntry => ({
    id: _id++,
    text,
    type,
});

beforeEach(() => {
    _id = 0;
    useCombatStore.setState({ sessionLog: [] });
    useCharacterStore.setState({ character: makeChar() });
    usePartyStore.setState({ party: null });
});

afterEach(() => {
    cleanup();
});

describe('CombatLogsModal — smoke', () => {
    it('renders title + close + empty message', () => {
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Logi walki/)).toBeTruthy();
        expect(screen.getByLabelText('Zamknij')).toBeTruthy();
    });

    it('renders all 5 filter buttons', () => {
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByTitle(/Moje ataki/)).toBeTruthy();
        expect(screen.getByTitle(/Sojusznicy/)).toBeTruthy();
        expect(screen.getByTitle(/Potwór/)).toBeTruthy();
        expect(screen.getByTitle(/Drop \/ XP/)).toBeTruthy();
        expect(screen.getByTitle(/Inne/)).toBeTruthy();
    });

    it('shows nick info in footer when character is set', () => {
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Twój nick:/)).toBeTruthy();
        expect(screen.getByText('Hero')).toBeTruthy();
    });
});

describe('CombatLogsModal — log rendering', () => {
    it('renders log entries from sessionLog', () => {
        useCombatStore.setState({
            sessionLog: [
                makeLog('Atakujesz Goblina za 25 dmg', 'player'),
                makeLog('Goblin atakuje cię za 10 dmg', 'monster'),
            ],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Atakujesz Goblina/)).toBeTruthy();
        expect(screen.getByText(/Goblin atakuje cię/)).toBeTruthy();
    });

    it('translates snake_case skill IDs to their Polish names', () => {
        useCombatStore.setState({
            sessionLog: [makeLog('[AUTO] poisoned_arrow: 1234 dmg', 'player')],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Zatruta Strzała/)).toBeTruthy();
        expect(screen.queryByText(/poisoned_arrow/)).toBeNull();
    });

    it('falls back to Title Case for unknown snake_case IDs', () => {
        useCombatStore.setState({
            sessionLog: [makeLog('cast some_unknown_spell', 'player')],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Some Unknown Spell/)).toBeTruthy();
    });

    it('shows count in title matching filtered list', () => {
        useCombatStore.setState({
            sessionLog: [
                makeLog('hit 1', 'player'),
                makeLog('hit 2', 'player'),
                makeLog('hit 3', 'player'),
            ],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        expect(screen.getByText(/Logi walki \(3\)/)).toBeTruthy();
    });
});

describe('CombatLogsModal — filter interactions', () => {
    it('filters out a bucket when its chip is toggled off', () => {
        useCombatStore.setState({
            sessionLog: [
                makeLog('Atakujesz Goblina', 'player'),
                makeLog('Goblin atakuje cię', 'monster'),
            ],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        // Both visible initially.
        expect(screen.getByText(/Atakujesz Goblina/)).toBeTruthy();
        expect(screen.getByText(/Goblin atakuje cię/)).toBeTruthy();
        // Toggle Monster filter OFF.
        fireEvent.click(screen.getByTitle(/Potwór/));
        expect(screen.getByText(/Atakujesz Goblina/)).toBeTruthy();
        expect(screen.queryByText(/Goblin atakuje cię/)).toBeNull();
    });

    it('shows empty state when all entries filtered out', () => {
        useCombatStore.setState({
            sessionLog: [makeLog('Atakujesz', 'player')],
        });
        render(<CombatLogsModal onClose={vi.fn()} />);
        fireEvent.click(screen.getByTitle(/Moje ataki/));
        expect(screen.getByText(/Brak logów dla wybranych filtrów/)).toBeTruthy();
    });
});

describe('CombatLogsModal — interactions', () => {
    it('fires onClose on × click', () => {
        const onClose = vi.fn();
        render(<CombatLogsModal onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Zamknij'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onClose on backdrop click', () => {
        const onClose = vi.fn();
        const { container } = render(<CombatLogsModal onClose={onClose} />);
        fireEvent.click(container.querySelector('.combat-ui__modal-bg')!);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
