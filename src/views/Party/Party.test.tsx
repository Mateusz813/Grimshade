import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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

vi.mock('../../components/ui/Chat/Chat', () => ({
    default: ({ channel }: { channel: string }) => <div data-testid={`chat-${channel}`} />,
}));

import Party from './Party';
import { useCharacterStore } from '../../stores/characterStore';
import { usePartyStore } from '../../stores/partyStore';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { useTransformStore } from '../../stores/transformStore';
import type { ICharacter } from '../../api/v1/characterApi';

const makeChar = (overrides: Partial<ICharacter> = {}): ICharacter => ({
    id: 'char-1',
    user_id: 'user-1',
    name: 'Hero',
    class: 'Knight',
    level: 10,
    xp: 0,
    hp: 100, max_hp: 100, mp: 30, max_mp: 30,
    attack: 15, defense: 12, attack_speed: 2.0,
    crit_chance: 3, crit_damage: 150, magic_level: 0,
    hp_regen: 0, mp_regen: 0,
    gold: 0, stat_points: 0, highest_level: 10,
    equipment: {},
    created_at: '', updated_at: '',
    ...overrides,
} as ICharacter);

const renderParty = () =>
    render(
        <MemoryRouter>
            <Party />
        </MemoryRouter>,
    );

beforeEach(() => {
    useCharacterStore.setState({ character: makeChar() });
    useTransformStore.setState({ completedTransforms: [] });
    usePartyPresenceStore.setState({ byMember: {} } as never);
    usePartyStore.setState({
        party: null,
        loading: false,
        error: null,
        publicParties: [],
        subscribePublicFeed: () => () => { },
        subscribeToActiveParty: () => () => { },
        refreshPublicParties: async () => { },
        hydrateActiveParty: async () => { },
    } as never);
});

afterEach(() => {
    cleanup();
});

describe('Party — smoke', () => {
    it('renders the root .party container', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party')).not.toBeNull();
    });

    it('shows the spinner-only layout when character is null', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderParty();
        expect(container.querySelector('.party')).not.toBeNull();
        expect(container.querySelector('.party__content')).toBeNull();
    });
});

describe('Party — hook-order regression (null -> loaded character)', () => {
    it('does not crash when the character hydrates from null after mount', () => {
        useCharacterStore.setState({ character: null });
        const { container } = renderParty();
        expect(container.querySelector('.party__content')).toBeNull();
        act(() => {
            useCharacterStore.setState({ character: makeChar() });
        });
        expect(container.querySelector('.party__content')).not.toBeNull();
    });
});

describe('Party — no-party branch (browser)', () => {
    it('renders the intro section with title + body text', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party__intro')).not.toBeNull();
        expect(container.querySelector('.party__intro-title')?.textContent).toBe('Party');
    });

    it('renders the "Stwórz nowe party" primary button', () => {
        const { container } = renderParty();
        const primary = container.querySelector('.party__primary-btn') as HTMLButtonElement;
        expect(primary?.textContent).toContain('Stwórz nowe party');
    });

    it('renders the section header for the public browser', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party__section-title')?.textContent).toContain('Otwarte drużyny');
    });

    it('renders the empty-browser message when publicParties is empty', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party__empty')).not.toBeNull();
    });
});

describe('Party — create form toggle', () => {
    it('reveals the create form when "Stwórz nowe party" is clicked', () => {
        const { container } = renderParty();
        const primary = container.querySelector('.party__primary-btn') as HTMLButtonElement;
        fireEvent.click(primary);
        expect(container.querySelector('.party__create-form')).not.toBeNull();
    });

    it('hides the create form when Anuluj is clicked', () => {
        const { container } = renderParty();
        const primary = container.querySelector('.party__primary-btn') as HTMLButtonElement;
        fireEvent.click(primary);
        const cancel = container.querySelector('.party__secondary-btn') as HTMLButtonElement;
        fireEvent.click(cancel);
        expect(container.querySelector('.party__create-form')).toBeNull();
    });

    it('reveals all 5 input fields in the create form', () => {
        const { container } = renderParty();
        fireEvent.click(container.querySelector('.party__primary-btn') as HTMLButtonElement);
        const inputs = container.querySelectorAll('.party__create-form input');
        expect(inputs.length).toBe(5);
    });
});

describe('Party — public browser cards', () => {
    it('renders one .party__card per browsable party', () => {
        usePartyStore.setState({
            publicParties: [{
                id: 'p1',
                leader_id: 'c1',
                name: 'Open team',
                description: 'come join',
                has_password: false,
                is_public: true,
                max_members: 4,
                min_join_level: 1,
                created_at: '2026-05-22T00:00:00.000Z',
                members: [{
                    character_id: 'c1',
                    character_name: 'Leader',
                    character_class: 'Mage',
                    character_level: 12,
                    is_leader: true,
                    joined_at: '2026-05-22T00:00:00.000Z',
                }],
            }],
        } as never);
        const { container } = renderParty();
        const cards = container.querySelectorAll('.party__card');
        expect(cards.length).toBe(1);
        expect(container.textContent).toContain('Open team');
    });

    it('skips full parties (members.length === max_members) from the browser', () => {
        usePartyStore.setState({
            publicParties: [{
                id: 'p_full',
                leader_id: 'c1',
                name: 'Full team',
                description: '',
                has_password: false,
                is_public: true,
                max_members: 1,
                min_join_level: 1,
                created_at: '2026-05-22T00:00:00.000Z',
                members: [{
                    character_id: 'c1',
                    character_name: 'Leader',
                    character_class: 'Mage',
                    character_level: 12,
                    is_leader: true,
                    joined_at: '2026-05-22T00:00:00.000Z',
                }],
            }],
        } as never);
        const { container } = renderParty();
        expect(container.querySelector('.party__empty')).not.toBeNull();
    });
});

describe('Party — refresh button', () => {
    it('calls refreshPublicParties when the :counterclockwise-arrows-button: button is clicked', () => {
        const refreshPublicParties = vi.fn(async () => { });
        usePartyStore.setState({ refreshPublicParties } as never);
        const { container } = renderParty();
        const refresh = container.querySelector('.party__refresh-btn') as HTMLButtonElement;
        fireEvent.click(refresh);
        expect(refreshPublicParties).toHaveBeenCalled();
    });
});

describe('Party — active dashboard (in a party)', () => {
    beforeEach(() => {
        usePartyStore.setState({
            party: {
                id: 'p1',
                leaderId: 'char-1',
                createdAt: '2026-05-22T00:00:00.000Z',
                name: 'Hero raid',
                description: 'killin stuff',
                hasPassword: false,
                isPublic: true,
                maxMembers: 4,
                minJoinLevel: 1,
                members: [{
                    id: 'char-1',
                    name: 'Hero',
                    class: 'Knight',
                    level: 10,
                    hp: 100,
                    maxHp: 100,
                    isOnline: true,
                }],
            },
        } as never);
    });

    it('no longer renders the no-party intro when in a party', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party__intro')).toBeNull();
    });

    it('renders the .party__content wrapper', () => {
        const { container } = renderParty();
        expect(container.querySelector('.party__content')).not.toBeNull();
    });
});

