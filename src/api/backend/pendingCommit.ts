// Koordynator "pending commit" — most bez cyklu importów.
//
// Problem: walka jest liczona po stronie klienta i utrwalana DEBOUNCOWANYM
// commitem stanu (patrz characterScope). Akcje ekonomiczne (market/shop/itemy)
// zostają autorytatywne po stronie serwera i po sobie robią syncFromBackend,
// który NADPISUJE lokalne store'y stanem serwera. Gdyby taka akcja poszła
// ZANIM commit walki dotrze do serwera, serwer czytałby nieaktualny blob i
// syncFromBackend skasowałby świeży progres walki.
//
// Rozwiązanie: przed KAŻDYM mutującym żądaniem do backendu (POST/PUT/DELETE,
// poza samym commitem /state) wypychamy zaległy commit walki. Dzięki temu
// serwer zawsze widzi najświeższy stan zanim go zmutuje/odczyta.
//
// characterScope rejestruje flusher (setPendingCommitFlusher); client.ts go
// woła w interceptorze requestu. Oddzielny mały moduł, bo charakterScope
// importuje backendApi -> client, więc client nie może importować characterScope.

type Flusher = () => Promise<void>;

let _flusher: Flusher | null = null;

/** Zarejestruj funkcję wypychającą zaległy commit (wołane raz przez characterScope). */
export const setPendingCommitFlusher = (fn: Flusher | null): void => {
    _flusher = fn;
};

/** Wypchnij zaległy commit (jeśli jest). Best-effort — błąd nie blokuje akcji. */
export const flushPendingCommit = async (): Promise<void> => {
    if (!_flusher) return;
    try {
        await _flusher();
    } catch {
        // best-effort — akcja i tak pójdzie; bufor lokalny zostaje
    }
};
