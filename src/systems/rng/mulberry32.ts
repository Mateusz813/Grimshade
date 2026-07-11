// Deterministyczny PRNG mulberry32 — bliźniak backendowego App\Domain\Support\Rng\Mulberry32Rng.
//
// Ten sam seed daje tę samą sekwencję w TS i PHP, więc golden-vectory (input→output
// systemów gry) generowane tu odtwarzają się bajt-w-bajt na serwerze. To fundament
// parytetu logiki: front i backend liczą identycznie, więc backend może być autorytetem
// bez rozjazdu z klientem.
//
// Uwaga: to NIE zamienia jeszcze Math.random() w kodzie gry — służy golden-vectorom
// i przyszłej deterministycznej symulacji (Opcja A party combat). Konwencje nextInt/
// shuffle są ustalone i muszą zgadzać się z portem PHP.

/** Deterministyczny generator mulberry32. Stan jako 32-bitowy uint. */
export class Mulberry32 {
    private state: number;

    constructor(seed: number) {
        this.state = seed | 0;
    }

    /** Surowy uint32 z sekwencji (przed dzieleniem na float). */
    nextUint32(): number {
        this.state = (this.state + 0x6d2b79f5) | 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), 1 | t);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return (t ^ (t >>> 14)) >>> 0;
    }

    /** Float w [0, 1). */
    nextFloat(): number {
        return this.nextUint32() / 4294967296;
    }

    /** Liczba całkowita w [min, max] włącznie. */
    nextInt(min: number, max: number): number {
        if (max <= min) return min;
        return min + Math.floor(this.nextFloat() * (max - min + 1));
    }

    /** Nowa przetasowana tablica (Fisher-Yates), bez mutacji wejścia. */
    shuffle<T>(items: readonly T[]): T[] {
        const result = [...items];
        for (let i = result.length - 1; i > 0; i--) {
            const j = this.nextInt(0, i);
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

/** Wygodny konstruktor. */
export const mulberry32 = (seed: number): Mulberry32 => new Mulberry32(seed);
