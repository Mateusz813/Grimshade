import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../../../systems/spriteAssets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../systems/spriteAssets')>();
    return {
        ...actual,
        getMonsterImage: (lvl: number) => (lvl <= 50 ? `/monsters/monster-${lvl}.png` : null),
        getMonsterImageNearest: (lvl: number) => (lvl <= 60 ? `/monsters/monster-50.png` : null),
        getBossImage: (lvl: number) => (lvl >= 100 ? `/boss/boss-${lvl}.png` : null),
        getBossImageNearest: (lvl: number) => (lvl >= 90 ? `/boss/boss-100.png` : null),
    };
});

import { MonsterSprite, BossSprite } from './MonsterSprite';

afterEach(() => {
    cleanup();
});

describe('MonsterSprite', () => {
    it('renders <img> with exact-level monster artwork', () => {
        const { container } = render(
            <MonsterSprite level={5} sprite="alien-monster" name="Slime" />,
        );
        const img = container.querySelector('img');
        expect(img).toBeTruthy();
        expect(img?.getAttribute('src')).toBe('/monsters/monster-5.png');
        expect(img?.getAttribute('alt')).toBe('Slime');
    });

    it('falls back to nearest-tier art when exact level missing', () => {
        const { container } = render(
            <MonsterSprite level={55} sprite="alien-monster" />,
        );
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('/monsters/monster-50.png');
    });

    it('renders emoji fallback when neither exact nor nearest URL available', () => {
        const { container } = render(
            <MonsterSprite level={999} sprite="ogre" />,
        );
        expect(container.querySelector('img')).toBeNull();
        const span = container.querySelector('span');
        expect(span?.textContent).toBe('ogre');
        expect(span?.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders default :alien-monster: glyph when sprite is missing entirely', () => {
        const { container } = render(<MonsterSprite level={999} />);
        const span = container.querySelector('span');
        expect(span?.textContent).toBe('alien-monster');
    });

    it('applies fill styling (100% width/height) by default', () => {
        const { container } = render(<MonsterSprite level={5} />);
        const img = container.querySelector('img') as HTMLImageElement;
        expect(img.style.width).toBe('100%');
        expect(img.style.height).toBe('100%');
    });

    it('passes through custom style when fill is false', () => {
        const { container } = render(
            <MonsterSprite level={5} fill={false} style={{ width: '42px' }} />,
        );
        const img = container.querySelector('img') as HTMLImageElement;
        expect(img.style.width).toBe('42px');
        expect(img.style.height).not.toBe('100%');
    });
});

describe('BossSprite', () => {
    it('renders exact-level boss artwork', () => {
        const { container } = render(
            <BossSprite level={100} sprite="ogre" name="Demon Lord" />,
        );
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('/boss/boss-100.png');
        expect(img?.getAttribute('alt')).toBe('Demon Lord');
    });

    it('falls back to nearest-tier boss art', () => {
        const { container } = render(<BossSprite level={92} sprite="ogre" />);
        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('/boss/boss-100.png');
    });

    it('renders emoji fallback when nothing matches', () => {
        const { container } = render(<BossSprite level={1} sprite="dragon" />);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('span')?.textContent).toBe('dragon');
    });
});
