import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const submitReportMock = vi.fn();
vi.mock('../../../api/v1/bugReportsApi', () => ({
    bugReportsApi: { submitReport: (...args: unknown[]) => submitReportMock(...args) },
    BUG_REPORT_CONTENT_MAX: 4000,
}));

import BugReportModal from './BugReportModal';
import { useCharacterStore } from '../../../stores/characterStore';
import { BUG_REPORT_VIEWS } from '../../../data/bugReportViews';
import type { ICharacter } from '../../../api/v1/characterApi';

const makeChar = (): ICharacter => ({
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
} as ICharacter);

const getSubmitBtn = () => screen.getByRole('button', { name: 'Wyślij' });
const getSelect = () => screen.getByLabelText('Gdzie wystąpił błąd?') as HTMLSelectElement;
const getTextarea = () => screen.getByLabelText('Opis błędu') as HTMLTextAreaElement;

beforeEach(() => {
    submitReportMock.mockReset();
    submitReportMock.mockResolvedValue({ id: 'b1' });
    useCharacterStore.setState({ character: makeChar() });
});

afterEach(() => {
    cleanup();
});

describe('BugReportModal — form state', () => {
    it('renders every view option plus an empty placeholder, with nothing selected by default', () => {
        render(<BugReportModal onClose={() => undefined} />);
        expect(getSelect().value).toBe('');
        const options = Array.from(getSelect().options);
        expect(options).toHaveLength(BUG_REPORT_VIEWS.length + 1);
        expect(options[0].disabled).toBe(true);
        expect(options.map((o) => o.value)).toEqual(['', ...BUG_REPORT_VIEWS.map((v) => v.key)]);
    });

    it('offers an "Inne" option', () => {
        render(<BugReportModal onClose={() => undefined} />);
        expect(Array.from(getSelect().options).map((o) => o.textContent)).toContain('Inne');
    });

    it('keeps the submit button disabled until both the view and the content are filled', () => {
        render(<BugReportModal onClose={() => undefined} />);
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(getTextarea(), { target: { value: 'Sklep nie działa' } });
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(false);
    });

    it('treats whitespace-only content as empty', () => {
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        fireEvent.change(getTextarea(), { target: { value: '    ' } });
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(true);
    });

    it('disables submit again when the view is cleared', () => {
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        fireEvent.change(getTextarea(), { target: { value: 'coś' } });
        fireEvent.change(getSelect(), { target: { value: '' } });
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(true);
    });
});

describe('BugReportModal — submit', () => {
    it('sends the selected view, the content and the active character', async () => {
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'boss' } });
        fireEvent.change(getTextarea(), { target: { value: 'Boss nie ginie' } });
        fireEvent.click(getSubmitBtn());

        await waitFor(() => expect(submitReportMock).toHaveBeenCalledTimes(1));
        expect(submitReportMock).toHaveBeenCalledWith({
            view_key: 'boss',
            content: 'Boss nie ginie',
            character_id: 'char-1',
            character_name: 'Hero',
        });
    });

    it('sends null character fields when no character is active', async () => {
        useCharacterStore.setState({ character: null });
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'other' } });
        fireEvent.change(getTextarea(), { target: { value: 'coś' } });
        fireEvent.click(getSubmitBtn());

        await waitFor(() => expect(submitReportMock).toHaveBeenCalled());
        expect(submitReportMock.mock.calls[0][0]).toMatchObject({
            character_id: null,
            character_name: null,
        });
    });

    it('shows a confirmation and auto-closes after a successful submit', async () => {
        const onClose = vi.fn();
        render(<BugReportModal onClose={onClose} />);
        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        fireEvent.change(getTextarea(), { target: { value: 'bug' } });
        fireEvent.click(getSubmitBtn());

        await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
        expect(screen.queryByRole('button', { name: 'Wyślij' })).toBeNull();
        await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 4000 });
    });

    it('shows an error and keeps the form open when the API throws', async () => {
        submitReportMock.mockRejectedValueOnce(new Error('network'));
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        fireEvent.change(getTextarea(), { target: { value: 'bug' } });
        fireEvent.click(getSubmitBtn());

        await waitFor(() =>
            expect(screen.getByText('Nie udało się zapisać zgłoszenia. Spróbuj ponownie.')).toBeTruthy(),
        );
        expect(getTextarea().value).toBe('bug');
        expect((getSubmitBtn() as HTMLButtonElement).disabled).toBe(false);
    });

    it('shows an error when the insert returns no row (e.g. missing session)', async () => {
        submitReportMock.mockResolvedValueOnce(null);
        render(<BugReportModal onClose={() => undefined} />);
        fireEvent.change(getSelect(), { target: { value: 'shop' } });
        fireEvent.change(getTextarea(), { target: { value: 'bug' } });
        fireEvent.click(getSubmitBtn());

        await waitFor(() =>
            expect(screen.getByText('Nie udało się zapisać zgłoszenia. Spróbuj ponownie.')).toBeTruthy(),
        );
    });
});

describe('BugReportModal — closing', () => {
    it('closes on Anuluj', () => {
        const onClose = vi.fn();
        render(<BugReportModal onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<BugReportModal onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('does not close when the dialog body is tapped', () => {
        const onClose = vi.fn();
        render(<BugReportModal onClose={onClose} />);
        fireEvent.click(screen.getByRole('dialog'));
        expect(onClose).not.toHaveBeenCalled();
    });
});
