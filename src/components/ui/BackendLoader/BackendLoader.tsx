import { useEffect, useState } from 'react';
import { useApiPendingStore } from '../../../stores/apiPendingStore';
import { useTransformStore } from '../../../stores/transformStore';
import './BackendLoader.scss';

/**
 * Globalny overlay podczas requestów do backendu (Laravel). Przyciemnia CAŁĄ
 * aplikację i blokuje klikanie, żeby gracz nie odpalił akcji dwa razy w trakcie
 * trwającego zapytania.
 *
 * Pokazuje się z opóźnieniem SHOW_DELAY_MS — szybkie odpowiedzi (rozgrzany backend
 * ~0.2s) NIE migają overlayem, a wolne (cold-start free-tier Rendera ~50s) blokują
 * interakcję z widocznym „Przetwarzanie…".
 *
 * Akcent (ring + poświata) w KOLORZE aktywnej transformacji gracza — spójnie z
 * resztą UI walki. Fallback na pomarańczowy, gdy brak odblokowanej transformacji.
 */
const SHOW_DELAY_MS = 350;
const DEFAULT_ACCENT = '#ff9800';

const BackendLoader = (): React.ReactElement | null => {
    const pending = useApiPendingStore((s) => s.pending);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (pending > 0) {
            const id = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
            return () => window.clearTimeout(id);
        }
        setVisible(false);
        return undefined;
    }, [pending]);

    if (!visible) return null;

    const tc = getHighestTransformColor();
    const accent = tc?.solid ?? tc?.gradient?.[0] ?? DEFAULT_ACCENT;
    const accent2 = tc?.gradient?.[1] ?? accent;
    const style = {
        '--loader-accent': accent,
        '--loader-accent-2': accent2,
    } as React.CSSProperties;

    return (
        <div className="backend-loader" role="status" aria-live="polite" aria-busy="true" style={style}>
            <div className="backend-loader__box">
                <div className="backend-loader__ring" aria-hidden="true" />
                <span className="backend-loader__text">Przetwarzanie…</span>
            </div>
        </div>
    );
};

export default BackendLoader;
