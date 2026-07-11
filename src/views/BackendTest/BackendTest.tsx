import { useState } from 'react';
import { useCharacterStore } from '../../stores/characterStore';
import { backendApi } from '../../api/backend/backendApi';
import {
    getBackendBaseUrl,
    isBackendConfigured,
    isBackendMode,
    setBackendMode,
} from '../../config/backendMode';

// Panel testowy backendu (dev). Klikasz endpoint → widzisz autorytatywną
// odpowiedź serwera. Additive, izolowany — NIE dotyka logiki gry. Trasa:
// /backend-test. Uwaga: endpointy ZAPISUJĄCE zmieniają realne dane postaci —
// testuj na postaci testowej.

interface IRow {
    label: string;
    run: (charId: string) => Promise<unknown>;
    needsChar?: boolean;
}

const BackendTest = () => {
    const character = useCharacterStore((s) => s.character);
    const [out, setOut] = useState<string>('');
    const [busy, setBusy] = useState<string>('');
    const [modeOn, setModeOn] = useState<boolean>(isBackendMode());

    // Pola pomocnicze na id-ki
    const [monsterId, setMonsterId] = useState('rat');
    const [itemUuid, setItemUuid] = useState('');
    const [genericId, setGenericId] = useState('');

    const charId = character?.id ?? '';

    const call = async (label: string, fn: () => Promise<unknown>) => {
        setBusy(label);
        setOut(`⏳ ${label}...`);
        try {
            const data = await fn();
            setOut(`✅ ${label}\n\n${JSON.stringify(data, null, 2)}`);
        } catch (e: unknown) {
            const err = e as { response?: { status?: number; data?: unknown }; message?: string };
            setOut(`❌ ${label}\nHTTP ${err.response?.status ?? '?'}\n\n${JSON.stringify(err.response?.data ?? err.message, null, 2)}`);
        } finally {
            setBusy('');
        }
    };

    const rows: IRow[] = [
        { label: 'GET /content/version', run: () => backendApi.contentVersion() },
        { label: 'GET /characters', run: () => backendApi.characters() },
        { label: 'GET /state', run: (id) => backendApi.state(id), needsChar: true },
        { label: `POST /combat/resolve (${monsterId})`, run: (id) => backendApi.combatResolve(id, monsterId), needsChar: true },
        { label: `POST /items/sell (${itemUuid || 'uuid?'})`, run: (id) => backendApi.sell(id, itemUuid), needsChar: true },
        { label: `POST /items/upgrade (${itemUuid || 'uuid?'})`, run: (id) => backendApi.upgrade(id, itemUuid), needsChar: true },
        { label: 'POST /shop/buy-elixir (hp_potion_sm ×1)', run: (id) => backendApi.buyElixir(id, 'hp_potion_sm', 1), needsChar: true },
        { label: 'GET /shop/catalog', run: () => backendApi.shopCatalog() },
        { label: `POST /boss/{id}/resolve (${genericId || 'id?'})`, run: (id) => backendApi.bossResolve(id, genericId), needsChar: true },
        { label: `POST /dungeon/{id}/resolve (${genericId || 'id?'})`, run: (id) => backendApi.dungeonResolve(id, genericId), needsChar: true },
        { label: `POST /transform/{id}/resolve (${genericId || 'id?'})`, run: (id) => backendApi.transformResolve(id, genericId), needsChar: true },
        { label: 'POST /offline-hunt/settle', run: (id) => backendApi.offlineHuntSettle(id), needsChar: true },
        { label: `POST /tasks/{id}/claim (${genericId || 'id?'})`, run: (id) => backendApi.claimTask(id, genericId), needsChar: true },
        { label: `POST /quests/{id}/claim (${genericId || 'id?'})`, run: (id) => backendApi.claimQuest(id, genericId), needsChar: true },
        { label: 'POST /daily-quests/refresh', run: (id) => backendApi.refreshDailyQuests(id), needsChar: true },
        { label: `POST /arena/match (${genericId || 'opponentId?'})`, run: (id) => backendApi.arenaMatch(id, genericId), needsChar: true },
        { label: 'GET /market/listings', run: () => backendApi.marketListings() },
        { label: 'GET /market/mine', run: (id) => backendApi.marketMine(id), needsChar: true },
        { label: 'GET /deaths', run: () => backendApi.deathsFeed() },
    ];

    const box: React.CSSProperties = { padding: 16, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui' };
    const btn: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', margin: '4px 0', cursor: 'pointer', borderRadius: 6, border: '1px solid #4443' };
    const inp: React.CSSProperties = { padding: 6, margin: '2px 6px 2px 0', borderRadius: 4, border: '1px solid #4446' };

    return (
        <div style={box}>
            <h2>🔧 Backend Test</h2>
            <p style={{ fontSize: 13, opacity: 0.8 }}>
                URL: <code>{getBackendBaseUrl() || '(brak VITE_API_BASE_URL)'}</code> · Skonfigurowany: {isBackendConfigured() ? 'tak' : 'NIE'}
            </p>
            {!isBackendConfigured() && (
                <p style={{ color: '#e53935' }}>Ustaw <code>VITE_API_BASE_URL</code> w <code>.env.local</code> i zrestartuj dev serwer.</p>
            )}
            <label style={{ display: 'block', margin: '8px 0' }}>
                <input
                    type="checkbox"
                    checked={modeOn}
                    onChange={(e) => { setBackendMode(e.target.checked); setModeOn(e.target.checked); }}
                /> Tryb backendu AKTYWNY (opt-in — gra go używa dopiero po zaznaczeniu)
            </label>
            <p style={{ fontSize: 13 }}>
                Postać: <strong>{character ? `${character.name} (lvl ${character.level})` : '— brak wybranej —'}</strong>
            </p>

            <div style={{ margin: '10px 0', padding: 8, background: '#8881', borderRadius: 6 }}>
                <div>
                    <label>monsterId <input style={inp} value={monsterId} onChange={(e) => setMonsterId(e.target.value)} /></label>
                    <label>itemUuid <input style={inp} value={itemUuid} onChange={(e) => setItemUuid(e.target.value)} placeholder="z /state inventory.bag" /></label>
                </div>
                <label>id (boss/dungeon/transform/task/quest/opponent) <input style={inp} value={genericId} onChange={(e) => setGenericId(e.target.value)} /></label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                    {rows.map((r) => (
                        <button
                            key={r.label}
                            style={{ ...btn, opacity: r.needsChar && !charId ? 0.5 : 1 }}
                            disabled={!!busy || (r.needsChar && !charId)}
                            onClick={() => call(r.label, () => r.run(charId))}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
                <pre style={{ background: '#1113', padding: 12, borderRadius: 6, overflow: 'auto', maxHeight: '70vh', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {out || 'Kliknij endpoint po lewej...'}
                </pre>
            </div>
        </div>
    );
};

export default BackendTest;
