import { useEffect, useState } from 'react';
import { useApiPendingStore } from '../../../stores/apiPendingStore';
import { useTransformStore } from '../../../stores/transformStore';
import pwaIcon from '../../../assets/images/pwa.png';
import './BackendLoader.scss';

/**
 * Globalny overlay podczas requestów do backendu (Laravel). Mocno przyciemnia
 * CAŁĄ aplikację i blokuje klikanie, żeby gracz nie odpalił akcji dwa razy w
 * trakcie trwającego zapytania.
 *
 * Zamiast spinnera: logo Grimshade + mieniący się napis „Grimshade" na środku
 * (bez boxa/ramki). Akcent mienienia w kolorze aktywnej transformacji gracza.
 *
 * Pokazuje się z opóźnieniem SHOW_DELAY_MS — szybkie odpowiedzi (rozgrzany backend
 * ~0.2s) NIE migają overlayem; wolne (cold-start free-tier Rendera ~50s) blokują.
 */
const SHOW_DELAY_MS = 350;
const DEFAULT_ACCENT = '#ffcf6b';

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
    const style = { '--loader-accent': accent } as React.CSSProperties;

    return (
        <div className="backend-loader" role="status" aria-live="polite" aria-busy="true" style={style}>
            <img className="backend-loader__logo" src={pwaIcon} alt="" aria-hidden="true" />
            <span className="backend-loader__brand">Grimshade</span>
        </div>
    );
};

export default BackendLoader;
