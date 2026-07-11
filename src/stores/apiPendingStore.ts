import { create } from 'zustand';

/**
 * Licznik requestów backendu „w locie". Zwiększany/zmniejszany przez interceptory
 * axiosa w `src/api/backend/client.ts`. `BackendLoader` pokazuje globalny overlay,
 * gdy `pending > 0` (z małym opóźnieniem), żeby gracz nie klikał w akcje podczas
 * trwającego zapytania — szczególnie przy cold-starcie free-tier Rendera (~50s).
 *
 * Dotyczy WYŁĄCZNIE klienta backendu (Laravel), nie odczytów Supabase (czat itp.).
 */
interface IApiPendingState {
    pending: number;
    inc: () => void;
    dec: () => void;
}

export const useApiPendingStore = create<IApiPendingState>((set) => ({
    pending: 0,
    inc: () => set((s) => ({ pending: s.pending + 1 })),
    // clamp do 0 — nigdy ujemny (obrona przed nierównowagą inc/dec).
    dec: () => set((s) => ({ pending: Math.max(0, s.pending - 1) })),
}));
