
export class Mulberry32 {
    private state: number;

    constructor(seed: number) {
        this.state = seed | 0;
    }

    nextUint32(): number {
        this.state = (this.state + 0x6d2b79f5) | 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    }

    nextFloat(): number {
        return this.nextUint32() / 4294967296;
    }

    nextInt(min: number, max: number): number {
        if (max <= min) return min;
        return min + Math.floor(this.nextFloat() * (max - min + 1));
    }

    shuffle<T>(items: readonly T[]): T[] {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

export const mulberry32 = (seed: number): Mulberry32 => new Mulberry32(seed);
