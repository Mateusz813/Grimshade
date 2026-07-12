import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';


const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
    return {
        ...actual,
        useNavigate: () => navigateMock,
    };
});

vi.mock('../../../hooks/useTransformAccent', () => ({
    useTransformAccent: () => ({ accent: '#e53935', accentRgb: '229, 57, 53' }),
}));

import BottomNav from './BottomNav';
import { useTaskStore } from '../../../stores/taskStore';
import { useQuestStore } from '../../../stores/questStore';
import { useDailyQuestStore } from '../../../stores/dailyQuestStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';

const renderAt = (path: string) =>
    render(
        <MemoryRouter initialEntries={[path]}>
            <BottomNav />
        </MemoryRouter>,
    );

beforeEach(() => {
    navigateMock.mockReset();
    useTaskStore.setState({ activeTasks: [], completedTasks: [], activeTask: null });
    useQuestStore.setState({ activeQuests: [], completedQuestIds: [] });
    useDailyQuestStore.setState({ activeQuests: [], lastRefreshDate: null, todayQuestDefs: [] });
    useConnectivityStore.setState({ mode: 'online', userExplicitlyOffline: false });
});

afterEach(() => {
    cleanup();
});

describe('BottomNav — smoke', () => {
    it('renders all six nav buttons', () => {
        renderAt('/');
        expect(screen.getByLabelText('Walka')).toBeTruthy();
        expect(screen.getByLabelText('Questy')).toBeTruthy();
        expect(screen.getByLabelText('Postać')).toBeTruthy();
        expect(screen.getByLabelText('Miasto')).toBeTruthy();
        expect(screen.getByLabelText('Społeczność')).toBeTruthy();
        expect(screen.getByLabelText('Sklep')).toBeTruthy();
    });

    it('renders with aria-label on the nav element', () => {
        renderAt('/');
        const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
        expect(nav).toBeTruthy();
    });
});

describe('BottomNav — active state', () => {
    it('marks Miasto as current page when at /', () => {
        renderAt('/');
        const miasto = screen.getByLabelText('Miasto');
        expect(miasto.getAttribute('aria-current')).toBe('page');
    });

    it('marks Walka active for /combat (via matches array)', () => {
        renderAt('/combat');
        const walka = screen.getByLabelText('Walka');
        expect(walka.getAttribute('aria-current')).toBe('page');
    });

    it('marks Społeczność active when on /friends sub-route', () => {
        renderAt('/friends');
        const social = screen.getByLabelText('Społeczność');
        expect(social.getAttribute('aria-current')).toBe('page');
    });

    it('marks Sklep active for /market (matches array)', () => {
        renderAt('/market');
        const sklep = screen.getByLabelText('Sklep');
        expect(sklep.getAttribute('aria-current')).toBe('page');
    });
});

describe('BottomNav — navigation clicks', () => {
    it('calls navigate(path) when a different tab is clicked', () => {
        renderAt('/');
        fireEvent.click(screen.getByLabelText('Walka'));
        expect(navigateMock).toHaveBeenCalledWith('/battle');
    });

    it('navigates with state.resetAt when the SAME tab is re-clicked', () => {
        renderAt('/quests');
        fireEvent.click(screen.getByLabelText('Questy'));
        expect(navigateMock).toHaveBeenCalledTimes(1);
        const [path, opts] = navigateMock.mock.calls[0];
        expect(path).toBe('/quests');
        expect(opts).toMatchObject({ replace: false });
        expect(typeof opts.state.resetAt).toBe('number');
    });
});

describe('BottomNav — offline gating', () => {
    it('disables Społeczność button in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        renderAt('/');
        const social = screen.getByLabelText('Społeczność (niedostępne w trybie offline)');
        expect((social as HTMLButtonElement).disabled).toBe(true);
        expect(social.getAttribute('aria-disabled')).toBe('true');
    });

    it('does NOT call navigate when offline-locked button is clicked', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        renderAt('/');
        const social = screen.getByLabelText('Społeczność (niedostępne w trybie offline)');
        fireEvent.click(social);
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('keeps non-social buttons enabled in offline mode', () => {
        useConnectivityStore.setState({ mode: 'offline' });
        renderAt('/');
        expect((screen.getByLabelText('Walka') as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByLabelText('Sklep') as HTMLButtonElement).disabled).toBe(false);
    });
});

describe('BottomNav — claimable dot on Questy', () => {
    it('renders no claim dot when nothing is ready', () => {
        renderAt('/');
        const questyBtn = screen.getByLabelText('Questy');
        expect(questyBtn.querySelector('.bottom-nav__claim-dot')).toBeNull();
    });

    it('renders a claim dot when a task is ready to claim', () => {
        useTaskStore.setState({
            activeTasks: [{
                id: 't1',
                monsterId: 'rat',
                monsterLevel: 1,
                monsterName: 'Rat',
                killCount: 10,
                rewardGold: 100,
                rewardXp: 50,
                progress: 10,
                startedAt: new Date().toISOString(),
            }],
            completedTasks: [],
            activeTask: null,
        });
        renderAt('/');
        const questyBtn = screen.getByLabelText('Questy');
        expect(questyBtn.querySelector('.bottom-nav__claim-dot')).not.toBeNull();
    });

    it('renders a claim dot when a daily quest is completed but not claimed', () => {
        useDailyQuestStore.setState({
            activeQuests: [{
                questId: 'dq1',
                progress: 5,
                completed: true,
                claimed: false,
            }],
            lastRefreshDate: '2026-05-22',
            todayQuestDefs: [],
        });
        renderAt('/');
        const questyBtn = screen.getByLabelText('Questy');
        expect(questyBtn.querySelector('.bottom-nav__claim-dot')).not.toBeNull();
    });
});
