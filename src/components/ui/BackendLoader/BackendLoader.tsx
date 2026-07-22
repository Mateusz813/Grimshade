import { useEffect, useRef, useState } from 'react';
import { useApiPendingStore } from '../../../stores/apiPendingStore';
import { useTransformStore } from '../../../stores/transformStore';
import pwaIcon from '../../../assets/images/pwa.png';
import './BackendLoader.scss';

const SHOW_DELAY_MS = 250;
const DEFAULT_ACCENT = '#ffcf6b';

const BackendLoader = (): React.ReactElement | null => {
    const pending = useApiPendingStore((s) => s.pending);
    const getHighestTransformColor = useTransformStore((s) => s.getHighestTransformColor);
    const [visible, setVisible] = useState(false);
    const timerRef = useRef<number | null>(null);

    useEffect(() => {
        if (pending > 0) {
            if (timerRef.current === null) {
                timerRef.current = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
            }
            return;
        }
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setVisible(false);
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
