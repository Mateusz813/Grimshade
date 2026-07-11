import { describe, it, expect } from 'vitest';
import { Mulberry32 } from './mulberry32';

// Referencyjne surowe uint32 (kanoniczny mulberry32). IDENTYCZNE liczby są w
// backendzie: grimshade-backend/tests/Golden/fixtures/prng/mulberry32.json.
// Obie strony asertują przeciw tej samej referencji → parytet TS↔PHP.
const REFERENCE: Record<number, number[]> = {
    1: [2693262067, 11749833, 2265367787, 4213581821, 4159151403, 1207330352, 2632122864, 3095568220],
    12345: [4207900869, 1317490944, 2079646450, 3513001552, 2187978186, 1492380277, 316786230, 3291647763],
    2654435761: [2347010974, 1973779238, 1061036011, 2230376248, 3819464677, 3016964525, 1827482187, 2020816894],
};

describe('Mulberry32 (PRNG parity)', () => {
    it('reproduces the canonical uint32 sequence for every seed', () => {
        for (const [seed, expected] of Object.entries(REFERENCE)) {
            const rng = new Mulberry32(Number(seed));
            const actual = expected.map(() => rng.nextUint32());
            expect(actual, `seed ${seed}`).toEqual(expected);
        }
    });

    it('derives nextFloat as uint32 / 2^32 in [0,1)', () => {
        const rng = new Mulberry32(1);
        for (const u32 of REFERENCE[1]) {
            const f = rng.nextFloat();
            expect(f).toBe(u32 / 4294967296);
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThan(1);
        }
    });

    it('is deterministic — same seed, same sequence', () => {
        const a = new Mulberry32(999);
        const b = new Mulberry32(999);
        const seqA = Array.from({ length: 20 }, () => a.nextUint32());
        const seqB = Array.from({ length: 20 }, () => b.nextUint32());
        expect(seqA).toEqual(seqB);
    });

    it('nextInt stays within inclusive range; shuffle preserves elements', () => {
        const rng = new Mulberry32(42);
        for (let i = 0; i < 100; i++) {
            const n = rng.nextInt(3, 7);
            expect(n).toBeGreaterThanOrEqual(3);
            expect(n).toBeLessThanOrEqual(7);
        }
        const shuffled = new Mulberry32(42).shuffle([1, 2, 3, 4, 5]);
        expect([...shuffled].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    });
});
