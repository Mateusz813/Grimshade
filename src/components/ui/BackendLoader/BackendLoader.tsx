import { useEffect, useState } from 'react';
import { useApiPendingStore } from '../../../stores/apiPendingStore';
import Spinner from '../Spinner/Spinner';
import './BackendLoader.scss';

/**
 * Globalny overlay podczas requestów do backendu (Laravel). Blokuje klikanie,
 * żeby gracz nie odpalił akcji dwa razy w trakcie trwającego zapytania.
 *
 * Pokazuje się z opóźnieniem SHOW_DELAY_MS — szybkie odpowiedzi (rozgrzany backend
 * ~0.2s) NIE migają overlayem, a wolne (cold-start free-tier Rendera ~50s) blokują
 * interakcję z widocznym „Przetwarzanie…".
 */
const SHOW_DELAY_MS = 350;

const BackendLoader = (): React.ReactElement | null => {
    const pending = useApiPendingStore((s) => s.pending);
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

    return (
        <div className="backend-loader" role="status" aria-live="polite" aria-busy="true">
            <div className="backend-loader__box">
                <Spinner size="lg" />
                <span className="backend-loader__text">Przetwarzanie…</span>
            </div>
        </div>
    );
};

export default BackendLoader;
