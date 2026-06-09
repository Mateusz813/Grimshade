import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

/**
 * TutorialModal — new-player guide. Portal to document.body → query via
 * document.querySelector. Data-driven from TUTORIAL_SECTIONS.
 *
 * Coverage: dialog chrome, one section per data entry (numbered + bulleted),
 * non-empty content guard, all close paths, inside-click no-op.
 */

import TutorialModal from './TutorialModal';
import { TUTORIAL_SECTIONS } from '../../../data/tutorial';

afterEach(() => {
    cleanup();
});

describe('TutorialModal — render', () => {
    it('renders the dialog + header title', () => {
        render(<TutorialModal onClose={vi.fn()} />);
        expect(document.querySelector('.tutorial')).not.toBeNull();
        expect(document.querySelector('.tutorial__title')?.textContent).toContain('Jak grać');
    });

    it('renders exactly one section per TUTORIAL_SECTIONS entry', () => {
        render(<TutorialModal onClose={vi.fn()} />);
        expect(document.querySelectorAll('.tutorial__section').length).toBe(TUTORIAL_SECTIONS.length);
    });

    it('numbers sections starting at 1 and each has a title + ≥1 bullet', () => {
        render(<TutorialModal onClose={vi.fn()} />);
        const nums = Array.from(document.querySelectorAll('.tutorial__section-num')).map((e) => e.textContent);
        expect(nums[0]).toBe('1.');
        document.querySelectorAll('.tutorial__section').forEach((s) => {
            expect((s.querySelector('.tutorial__section-title')?.textContent ?? '').length).toBeGreaterThan(0);
            expect(s.querySelectorAll('.tutorial__section-bullet').length).toBeGreaterThan(0);
        });
    });
});

describe('TutorialModal — content completeness', () => {
    it('ships a substantial guide (≥10 sections, covering the main views)', () => {
        expect(TUTORIAL_SECTIONS.length).toBeGreaterThanOrEqual(10);
    });

    it('every section has a unique id, an icon, a summary and bullets', () => {
        const ids = new Set<string>();
        for (const s of TUTORIAL_SECTIONS) {
            expect(s.id.length).toBeGreaterThan(0);
            expect(ids.has(s.id)).toBe(false);
            ids.add(s.id);
            expect(s.icon.length).toBeGreaterThan(0);
            expect(s.title.length).toBeGreaterThan(0);
            expect(s.summary.length).toBeGreaterThan(0);
            expect(s.bullets.length).toBeGreaterThan(0);
        }
    });
});

describe('TutorialModal — close paths', () => {
    it('closes on backdrop click', () => {
        const onClose = vi.fn();
        render(<TutorialModal onClose={onClose} />);
        fireEvent.click(document.querySelector('.tutorial__backdrop') as HTMLElement);
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on the ✕ button', () => {
        const onClose = vi.fn();
        render(<TutorialModal onClose={onClose} />);
        fireEvent.click(document.querySelector('.tutorial__close') as HTMLElement);
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on the "Rozumiem" footer button', () => {
        const onClose = vi.fn();
        render(<TutorialModal onClose={onClose} />);
        fireEvent.click(document.querySelector('.tutorial__done') as HTMLElement);
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape', () => {
        const onClose = vi.fn();
        render(<TutorialModal onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('does NOT close when clicking inside the dialog body', () => {
        const onClose = vi.fn();
        render(<TutorialModal onClose={onClose} />);
        fireEvent.click(document.querySelector('.tutorial') as HTMLElement);
        expect(onClose).not.toHaveBeenCalled();
    });
});
