import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import Icon from './Icon';
import { ICON_NAMES } from './icons';

afterEach(() => {
    cleanup();
});

describe('Icon (owned inline-SVG UI glyphs)', () => {
    it('renders an svg with 24×24 viewBox and currentColor stroke', () => {
        const { container } = render(<Icon name="eye" />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg.getAttribute('stroke')).toBe('currentColor');
    });

    it('defaults to size 1em so it scales with text', () => {
        const { container } = render(<Icon name="arrowUp" />);
        expect(container.querySelector('svg')!.getAttribute('width')).toBe('1em');
    });

    it('accepts a numeric size', () => {
        const { container } = render(<Icon name="arrowUp" size={18} />);
        expect(container.querySelector('svg')!.getAttribute('width')).toBe('18');
    });

    it('is decorative (aria-hidden) without a title', () => {
        const { container } = render(<Icon name="dot" />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.getAttribute('role')).toBeNull();
    });

    it('is labelled (role=img + <title>) with a title', () => {
        const { container } = render(<Icon name="eye" title="Pokaż" />);
        const svg = container.querySelector('svg')!;
        expect(svg.getAttribute('role')).toBe('img');
        expect(container.querySelector('title')?.textContent).toBe('Pokaż');
    });

    it('merges a custom className (e.g. spin)', () => {
        const { container } = render(<Icon name="refresh" className="ui-icon--spin" />);
        const svg = container.querySelector('svg')!;
        expect(svg.classList.contains('ui-icon')).toBe(true);
        expect(svg.classList.contains('ui-icon--spin')).toBe(true);
    });

    it('renders every registered icon with at least one shape', () => {
        for (const name of ICON_NAMES) {
            const { container, unmount } = render(<Icon name={name} />);
            const shapes = container.querySelectorAll('path, circle');
            expect(shapes.length, `icon "${name}" has no shape`).toBeGreaterThan(0);
            unmount();
        }
    });

    it('dot is a filled circle (currentColor fill, no stroke)', () => {
        const { container } = render(<Icon name="dot" />);
        const circle = container.querySelector('circle')!;
        expect(circle.getAttribute('fill')).toBe('currentColor');
        expect(circle.getAttribute('stroke')).toBe('none');
    });
});
