import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


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

vi.mock('../../stores/characterScope', () => ({
    commitCombatEventNow: vi.fn(),
}));

import OfflineHunt, { RewardModal } from './OfflineHunt';
import { commitCombatEventNow } from '../../stores/characterScope';
import type { IOfflineHuntClaimResult } from '../../systems/offlineHuntSystem';
import { useCharacterStore } from '../../stores/characterStore';
import { useSkillStore } from '../../stores/skillStore';
import { useMasteryStore } from '../../stores/masteryStore';
import { useTransformStore } from '../../stores/transformStore';
import { useOfflineHuntStore } from '../../stores/offlineHuntStore';
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

const renderOfflineHunt = () =>
    render(
        <MemoryRouter>
            <OfflineHunt />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useSkillStore.setState({ skillLevels: {} });
    useMasteryStore.setState({ masteries: {}, masteryKills: {} });
    useTransformStore.setState({ completedTransforms: [] });
    useOfflineHuntStore.setState({
        isActive: false,
        startedAt: null,
        targetMonster: null,
        trainedSkillId: null,
    });
});

afterEach(() => {
    cleanup();
});

describe('OfflineHunt — smoke', () => {
    it('renders the .oh root + setup container when no hunt is active', () => {
        const { container } = renderOfflineHunt();
        expect(container.querySelector('.oh')).not.toBeNull();
        expect(container.querySelector('.oh__setup')).not.toBeNull();
    });

    it('renders the no-character empty state', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderOfflineHunt();
        expect(container.querySelector('.oh__empty')).not.toBeNull();
        expect(container.textContent).toContain('Brak aktywnej postaci');
    });
});

describe('OfflineHunt — setup steps', () => {
    it('renders two step cards (skill + monster)', () => {
        const { container } = renderOfflineHunt();
        const cards = container.querySelectorAll('.oh__card');
        expect(cards.length).toBe(2);
    });

    it('lists at least one trainable skill chip for Knight', () => {
        const { container } = renderOfflineHunt();
        const skills = container.querySelectorAll('.oh__skill-chip');
        expect(skills.length).toBeGreaterThan(0);
    });

    it('lists at least one unlocked monster (level 1 starters)', () => {
        const { container } = renderOfflineHunt();
        const monsters = container.querySelectorAll('.oh__monster-row');
        expect(monsters.length).toBeGreaterThan(0);
    });

    it('renders sort buttons (Lvl / Mastery) with one active by default', () => {
        const { container } = renderOfflineHunt();
        const sortBtns = container.querySelectorAll('.oh__sort-chip');
        expect(sortBtns.length).toBe(2);
        const active = container.querySelector('.oh__sort-chip--active');
        expect(active).not.toBeNull();
        expect(active?.textContent).toMatch(/Lvl/);
    });

    it('toggles the active sort modifier when the other button is clicked', () => {
        const { container } = renderOfflineHunt();
        const sortBtns = container.querySelectorAll('.oh__sort-chip');
        fireEvent.click(sortBtns[1]);
        expect(sortBtns[1].className).toContain('oh__sort-chip--active');
        expect(sortBtns[0].className).not.toContain('oh__sort-chip--active');
    });
});

describe('OfflineHunt — start CTA', () => {
    it('keeps the start button disabled until both skill + monster picked', () => {
        const { container } = renderOfflineHunt();
        const startBtn = container.querySelector('.oh__btn--start') as HTMLButtonElement;
        expect(startBtn.disabled).toBe(true);

        const skillChip = container.querySelector('.oh__skill-chip') as HTMLButtonElement;
        fireEvent.click(skillChip);
        expect(startBtn.disabled).toBe(true);

        const monsterRow = container.querySelector('.oh__monster-row') as HTMLButtonElement;
        fireEvent.click(monsterRow);
        expect(startBtn.disabled).toBe(false);
    });

    it('marks the picked skill + monster with the active modifier', () => {
        const { container } = renderOfflineHunt();
        const skillChip = container.querySelector('.oh__skill-chip') as HTMLButtonElement;
        fireEvent.click(skillChip);
        expect(skillChip.className).toContain('oh__skill-chip--active');

        const monsterRow = container.querySelector('.oh__monster-row') as HTMLButtonElement;
        fireEvent.click(monsterRow);
        expect(monsterRow.className).toContain('oh__monster-row--active');
    });

    it('forces an immediate persist on start so a briefly-open session cannot lose the hunt', () => {
        vi.mocked(commitCombatEventNow).mockClear();
        const { container } = renderOfflineHunt();
        fireEvent.click(container.querySelector('.oh__skill-chip') as HTMLButtonElement);
        fireEvent.click(container.querySelector('.oh__monster-row') as HTMLButtonElement);
        fireEvent.click(container.querySelector('.oh__btn--start') as HTMLButtonElement);
        expect(useOfflineHuntStore.getState().isActive).toBe(true);
        expect(vi.mocked(commitCombatEventNow)).toHaveBeenCalledWith({ type: 'offline-hunt' });
    });
});

describe('OfflineHunt — active hunt card', () => {
    it('renders the active card with progress + claim button when hunt is running', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: {
                id: 'goblin', name_pl: 'Goblin', level: 3, sprite: 'alien-monster',
                hp: 50, defense: 1, speed: 1, attack: 5, xp: 10,
                gold: [1, 2], magical: false,
            } as never,
            trainedSkillId: 'sword_fighting',
        });

        const { container } = renderOfflineHunt();
        expect(container.querySelector('.oh__active')).not.toBeNull();
        expect(container.querySelector('.oh__btn--claim')).not.toBeNull();
        expect(container.textContent).toContain('Polowanie aktywne');
        expect(container.textContent).toContain('Goblin');
    });

    it('omits the setup card when a hunt is active', () => {
        useOfflineHuntStore.setState({
            isActive: true,
            startedAt: new Date().toISOString(),
            targetMonster: {
                id: 'goblin', name_pl: 'Goblin', level: 3, sprite: 'alien-monster',
                hp: 50, defense: 1, speed: 1, attack: 5, xp: 10,
                gold: [1, 2], magical: false,
            } as never,
            trainedSkillId: 'sword_fighting',
        });
        const { container } = renderOfflineHunt();
        expect(container.querySelector('.oh__setup')).toBeNull();
    });
});

describe('OfflineHunt — reward modal close button (BUG #3)', () => {
    const makeResult = (): IOfflineHuntClaimResult => ({
        elapsedSeconds: 60,
        cappedSeconds: 60,
        kills: 5,
        xpGained: 100,
        goldGained: 50,
        skillXpGained: 20,
        skillId: 'sword_fighting',
        monster: {
            id: 'goblin', name_pl: 'Goblin', level: 3, sprite: 'alien-monster',
            hp: 50, defense: 1, speed: 1, attack: 5, xp: 10,
            gold: [1, 2], magical: false,
        } as never,
        speedMultiplier: 1,
        levelBefore: 5,
        levelAfter: 5,
        levelsGained: 0,
        xpPctOfLevel: 12.5,
        xpProgressAfter: 100,
        xpNeededAfter: 800,
        skillLevelBefore: 0,
        skillLevelAfter: 0,
        skillLevelsGained: 0,
        skillXpPctOfLevel: 5,
        killsByRarity: { normal: 5, strong: 0, epic: 0, legendary: 0, boss: 0 },
        itemDrops: [],
        potionDrops: {},
        spellChestDrops: {},
        stoneDrops: {},
    });

    it('renders a top-right close (X) button in the modal header', () => {
        const { container } = render(<RewardModal result={makeResult()} onClose={() => {}} />);
        const closeBtn = container.querySelector('.oh-modal__close');
        expect(closeBtn).not.toBeNull();
        expect(closeBtn?.getAttribute('aria-label')).toBe('Zamknij');
    });

    it('calls onClose when the close (X) button is clicked', () => {
        const onClose = vi.fn();
        const { container } = render(<RewardModal result={makeResult()} onClose={onClose} />);
        const closeBtn = container.querySelector('.oh-modal__close') as HTMLButtonElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the OK button is clicked', () => {
        const onClose = vi.fn();
        const { container } = render(<RewardModal result={makeResult()} onClose={onClose} />);
        const okBtn = container.querySelector('.oh-modal__ok-btn') as HTMLButtonElement;
        fireEvent.click(okBtn);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('OfflineHunt — class variants', () => {
    it('renders trainable skills for Mage class', () => {
        useCharacterStore.setState({ character: makeChar({ class: 'Mage' }) });
        const { container } = renderOfflineHunt();
        const skills = container.querySelectorAll('.oh__skill-chip');
        expect(skills.length).toBeGreaterThan(0);
    });
});

