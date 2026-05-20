import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useConnectivityStore } from '../stores/connectivityStore';

interface IProps {
    children: React.ReactNode;
}

/**
 * 2026-05-20 spec: route guard that redirects the player back to /town
 * when they try to enter an online-only feature while in offline mode.
 *
 * Wraps the following routes via `AppRouter.tsx`:
 *   • /arena, /arena/match — PvP, multiplayer-only
 *   • /raid                — party-only by design
 *   • /party               — managing a party is meaningless when you
 *                            can't be in one
 *   • /social, /friends    — these are online concepts; the guard
 *                            keeps them inaccessible until the player
 *                            switches back. Chat globally is allowed
 *                            (read-only is fine), but the dedicated
 *                            social hub is gated.
 *
 * Renders nothing while redirecting — React Router's <Navigate replace>
 * fires synchronously on first render so the player sees a single tick
 * of empty page at most.
 *
 * A one-shot console hint also fires on a redirect so dev consoles
 * surface the cause; player-facing messaging is the offline pill in the
 * TopHeader (always visible) + the avatar-menu toggle that got them
 * here.
 */
const OnlineOnlyGuard = ({ children }: IProps) => {
    const mode = useConnectivityStore((s) => s.mode);
    const location = useLocation();
    const navigate = useNavigate();
    useEffect(() => {
        if (mode === 'offline') {
            // eslint-disable-next-line no-console
            console.info('[OnlineOnlyGuard] Blocked', location.pathname, '— offline mode active');
        }
    }, [mode, location.pathname]);
    if (mode === 'offline') {
        // The replace prevents the back button from looping the player
        // straight back into the blocked route.
        return <Navigate to="/" replace state={{ blockedFrom: location.pathname }} />;
    }
    // Suppress the unused `navigate` warning — kept reserved for future
    // toast-on-block UX without re-importing the hook.
    void navigate;
    return <>{children}</>;
};

export default OnlineOnlyGuard;
