// Cache ostatniego access-tokenu (JWT GoTrue). Potrzebny do zapisu przy
// ZAMYKANIU karty (pagehide/visibilitychange→hidden): tam NIE ma czasu na
// async `supabase.auth.getSession()`, a `fetch(..., {keepalive:true})` wymaga
// nagłówka Authorization synchronicznie. Ustawiany przy każdym requeście do
// backendu (client.ts), czytany przez commit-keepalive (commit.ts).
let _token: string | null = null;

export const setAuthToken = (t: string | null): void => {
    _token = t;
};

export const getAuthToken = (): string | null => _token;
