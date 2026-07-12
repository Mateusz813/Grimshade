import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        isImageUrl: (icon: string) => icon.startsWith('/') || icon.startsWith('http'),
    };
});

import TinyIcon from './TinyIcon';

afterEach(() => {
    cleanup();
});

describe('TinyIcon — image branch', () => {
    it('renders an <img> when the icon resolves to a URL', () => {
        const { container } = render(<TinyIcon icon="/some/icon.png" alt="potion" />);
        const img = container.querySelector('img');
        expect(img).toBeTruthy();
        expect(img?.getAttribute('src')).toBe('/some/icon.png');
        expect(img?.getAttribute('alt')).toBe('potion');
        expect(container.querySelector('span')).toBeNull();
    });

    it('passes through className on the rendered image', () => {
        const { container } = render(
            <TinyIcon icon="/icon.png" className="x" />,
        );
        const img = container.querySelector('img');
        expect(img?.className).toBe('x');
    });

    it('resolves the size keyword (sm/md/lg) to expected pixel width', () => {
        const { container } = render(<TinyIcon icon="/icon.png" size="lg" />);
        const img = container.querySelector('img') as HTMLImageElement;
        expect(img.style.width).toBe('24px');
        expect(img.style.height).toBe('24px');
    });

    it('accepts a numeric size override', () => {
        const { container } = render(<TinyIcon icon="/icon.png" size={32} />);
        const img = container.querySelector('img') as HTMLImageElement;
        expect(img.style.width).toBe('32px');
    });
});

describe('TinyIcon — emoji branch', () => {
    it('renders the emoji as an inline <svg> (via <GameIcon>) when icon is not a URL', () => {
        const { container } = render(<TinyIcon icon="fire" />);
        const svg = container.querySelector('span svg.game-icon');
        expect(svg?.getAttribute('data-icon')).toBe('fire');
    });

    it('applies the resolved font-size to the emoji span', () => {
        const { container } = render(<TinyIcon icon="sparkles" size="sm" />);
        const span = container.querySelector('span') as HTMLSpanElement;
        expect(span.style.fontSize).toBe('14px');
    });
});
