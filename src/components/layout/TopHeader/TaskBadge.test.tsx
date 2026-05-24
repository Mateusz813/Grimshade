import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import TaskBadge from './TaskBadge';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useCombatStore } from '../../../stores/combatStore';

/**
 * TaskBadge — globalna ikonka "📋 N" w TopHeader.
 *
 * Renderuje listę aktywnych tasków + kill-quest goals. Każdy row ma
 * status (done / live / pending), badge ma color-coded dot:
 *   purple → claimable (claimableCount > 0)
 *   green  → live (właśnie walczę z monstrum który ma task aktywny)
 *   none   → nic
 *
 * Renderuje `null` gdy zero aktywnych tasków + quest goals.
 */

describe('TaskBadge', () => {
    beforeEach(() => {
        useTaskStore.setState({ activeTasks: [], completedTasks: [] });
        useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
        useCharacterStore.setState({
            character: {
                id: 'c1', user_id: 'u1', name: 'Hero', class: 'Knight',
                level: 50, xp: 0, hp: 100, max_hp: 100, mp: 30, max_mp: 30,
                hp_regen: 0, mp_regen: 0, attack: 10, defense: 5,
                attack_speed: 2, crit_chance: 5, crit_damage: 200,
                magic_level: 0, stat_points: 0, gold: 0,
            } as unknown as Parameters<typeof useCharacterStore.setState>[0]['character'],
        });
        useCombatStore.setState({
            phase: 'idle',
            backgroundActive: false,
            monster: null,
            baseMonster: null,
        } as unknown as Parameters<typeof useCombatStore.setState>[0]);
    });

    it('renders null when there are no tasks or quests', () => {
        const { container } = render(<TaskBadge />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the badge with task count when there is an active task', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1', taskId: 'rat-task', monsterId: 'rat',
                monsterName: 'Szczur', killCount: 10, progress: 3,
                rewardXp: 100, rewardGold: 50, acceptedAt: new Date().toISOString(),
            }],
        } as unknown as Parameters<typeof useTaskStore.setState>[0]);
        const { container } = render(<TaskBadge />);
        expect(container.querySelector('.top-header__tasks-btn')).not.toBeNull();
        expect(container.querySelector('.top-header__tasks-count')?.textContent).toBe('1');
    });

    it('shows claimable dot (purple) when claimableCount > 0', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1', taskId: 'rat-task', monsterId: 'rat',
                monsterName: 'Szczur', killCount: 10, progress: 10,
                rewardXp: 100, rewardGold: 50, acceptedAt: new Date().toISOString(),
            }],
        } as unknown as Parameters<typeof useTaskStore.setState>[0]);
        const { container } = render(<TaskBadge claimableCount={2} />);
        expect(container.querySelector('.top-header__tasks-btn--claimable')).not.toBeNull();
        expect(container.querySelector('.top-header__tasks-status-dot--claim')).not.toBeNull();
    });

    it('shows live dot (green) when player is fighting a task monster', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1', taskId: 'rat-task', monsterId: 'rat',
                monsterName: 'Szczur', killCount: 10, progress: 3,
                rewardXp: 100, rewardGold: 50, acceptedAt: new Date().toISOString(),
            }],
        } as unknown as Parameters<typeof useTaskStore.setState>[0]);
        useCombatStore.setState({
            phase: 'fighting',
            backgroundActive: false,
            monster: { id: 'rat', name_pl: 'Szczur' },
            baseMonster: { id: 'rat', name_pl: 'Szczur' },
        } as unknown as Parameters<typeof useCombatStore.setState>[0]);
        const { container } = render(<TaskBadge />);
        expect(container.querySelector('.top-header__tasks-btn--live')).not.toBeNull();
        expect(container.querySelector('.top-header__tasks-status-dot--live')).not.toBeNull();
    });

    it('opens dropdown when button is clicked', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1', taskId: 'rat-task', monsterId: 'rat',
                monsterName: 'Szczur', killCount: 10, progress: 3,
                rewardXp: 100, rewardGold: 50, acceptedAt: new Date().toISOString(),
            }],
        } as unknown as Parameters<typeof useTaskStore.setState>[0]);
        const { container } = render(<TaskBadge />);
        expect(container.querySelector('.top-header__tasks-dropdown')).toBeNull();
        fireEvent.click(container.querySelector('.top-header__tasks-btn') as HTMLElement);
        expect(container.querySelector('.top-header__tasks-dropdown')).not.toBeNull();
    });

    it('uses 🎁 icon when claimable, 📋 otherwise', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1', taskId: 'rat-task', monsterId: 'rat',
                monsterName: 'Szczur', killCount: 10, progress: 10,
                rewardXp: 100, rewardGold: 50, acceptedAt: new Date().toISOString(),
            }],
        } as unknown as Parameters<typeof useTaskStore.setState>[0]);
        const { container: claimable } = render(<TaskBadge claimableCount={1} />);
        expect(claimable.querySelector('.top-header__tasks-icon')?.textContent).toBe('🎁');

        const { container: pending } = render(<TaskBadge />);
        expect(pending.querySelector('.top-header__tasks-icon')?.textContent).toBe('📋');
    });

    // TODO: test requires mocking getQuestById to return a quest with
    // minLevel — bez tego filter w komponencie nie triggeruje się bo
    // unknown questId zwraca null. Skipnij until proper quest fixture.
    it.skip('hides quests whose minLevel exceeds the player level', () => {
        // Player lvl 5, quest requires lvl 100 — should be filtered out.
        useCharacterStore.setState((s) => ({
            character: { ...(s.character ?? {}), level: 5 } as unknown as typeof s.character,
        }) as Parameters<typeof useCharacterStore.setState>[0]);
        useQuestStore.setState({
            activeQuests: [{
                questId: 'high-lvl-quest',
                acceptedAt: new Date().toISOString(),
                goals: [{ type: 'kill', monsterId: 'rat', count: 50, progress: 0 }],
            }],
        } as unknown as Parameters<typeof useQuestStore.setState>[0]);
        const { container } = render(<TaskBadge />);
        // No tasks + quest hidden → returns null
        expect(container.firstChild).toBeNull();
    });
});
