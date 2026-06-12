import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import CombatTaskBadge from './CombatTaskBadge';
import type { ICombatActiveQuest } from './types';

afterEach(() => {
    cleanup();
});

const makeQuest = (overrides: Partial<ICombatActiveQuest> = {}): ICombatActiveQuest => ({
    id: 'q-1',
    kind: 'task',
    label: 'Kill 10 goblins',
    progress: 3,
    goal: 10,
    completed: false,
    ...overrides,
});

describe('CombatTaskBadge — visibility', () => {
    it('renders nothing when items is empty', () => {
        const { container } = render(<CombatTaskBadge items={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders badge + count when items present', () => {
        render(<CombatTaskBadge items={[makeQuest(), makeQuest({ id: 'q-2' })]} />);
        // Dropdown closed: only the trigger button's :scroll: is rendered, via
        // <Emoji> as a Twemoji <img> (alt carries the glyph).
        expect(document.querySelector('svg.game-icon[data-icon="scroll"]')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
    });
});

describe('CombatTaskBadge — interactions', () => {
    it('opens dropdown on button click and shows quest rows', () => {
        const { container } = render(
            <CombatTaskBadge items={[makeQuest({ label: 'Kill 5 orcs', progress: 2, goal: 5 })]} />,
        );
        // Dropdown hidden initially.
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeNull();
        fireEvent.click(container.querySelector('.combat-ui__task-badge-btn')!);
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeTruthy();
        expect(screen.getByText('Kill 5 orcs')).toBeTruthy();
        expect(screen.getByText('2/5')).toBeTruthy();
    });

    it('toggles dropdown closed on second click', () => {
        const { container } = render(
            <CombatTaskBadge items={[makeQuest()]} />,
        );
        const btn = container.querySelector('.combat-ui__task-badge-btn')!;
        fireEvent.click(btn);
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeTruthy();
        fireEvent.click(btn);
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeNull();
    });

    it('uses task icon for kind=task and quest icon for kind=quest', () => {
        const { container } = render(
            <CombatTaskBadge
                items={[
                    makeQuest({ id: 'a', kind: 'task' }),
                    makeQuest({ id: 'b', kind: 'quest' }),
                ]}
            />,
        );
        fireEvent.click(container.querySelector('.combat-ui__task-badge-btn')!);
        // :clipboard: task icon, :scroll: quest icon — both rendered via <Emoji> as svg.game-icon
        // in the rows. The trigger button also shows :scroll: via <Emoji>, so :scroll:
        // appears twice (trigger + quest row); :clipboard: only in the task row.
        expect(document.querySelectorAll('svg.game-icon[data-icon="scroll"]').length).toBe(2);
        expect(document.querySelector('svg.game-icon[data-icon="clipboard"]')).toBeTruthy();
    });

    it('renders completed row with :check-mark-button: icon and done modifier', () => {
        const { container } = render(
            <CombatTaskBadge items={[makeQuest({ completed: true, progress: 10, goal: 10 })]} />,
        );
        fireEvent.click(container.querySelector('.combat-ui__task-badge-btn')!);
        expect(document.querySelector('svg.game-icon[data-icon="check-mark-button"]')).toBeTruthy();
        expect(container.querySelector('.combat-ui__task-row--done')).toBeTruthy();
    });

    it('caps progress display to goal even if progress exceeds it', () => {
        const { container } = render(
            <CombatTaskBadge items={[makeQuest({ progress: 99, goal: 10 })]} />,
        );
        fireEvent.click(container.querySelector('.combat-ui__task-badge-btn')!);
        expect(screen.getByText('10/10')).toBeTruthy();
    });

    it('closes dropdown when clicking outside (mousedown on document)', () => {
        const { container } = render(
            <div>
                <CombatTaskBadge items={[makeQuest()]} />
                <button type="button" data-testid="outside">Outside</button>
            </div>,
        );
        fireEvent.click(container.querySelector('.combat-ui__task-badge-btn')!);
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeTruthy();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(container.querySelector('.combat-ui__task-badge-dropdown')).toBeNull();
    });
});
