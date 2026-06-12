import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import ChatPopup from './ChatPopup';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './ChatUnreadBadge.scss';

// 2026-05-19 v8 spec ("Ikonka chatu jest przed wejsciem na postac to
// blad"): routes the player can be on WITHOUT having committed to a
// character. The chat icon stays hidden until they pick / create a
// character and arrive on `/` (or any in-game route).
const CHARACTERLESS_ROUTES = new Set<string>([
    '/login',
    '/register',
    '/forgot-password',
    '/character-select',
    '/create-character',
]);

/**
 * Floating bottom-left chat icon — permanent across every screen once
 * the player has entered a character.
 *
 * 2026-05-19 spec ("Ikonka czatu na stale w prawym dolnym rogu ale na
 * prawde mala"): the badge is always rendered (no more "hide when
 * count == 0").
 *
 * 2026-05-19 v6 spec ("Jezeli ktos napisze na chacie gildi lub party
 * lub DM to powinna wyskakiwac mi ikonka taki czerwona kropka, albo
 * kropka w kolorze transformu i znika jak klikam w ikonke chatu"):
 * a single notification dot rides the top-right corner of the icon.
 * It lights up in the player's highest-transform colour the moment a
 * new message lands on a non-city channel (guild / party / system /
 * PM) and disappears the instant the player clicks the icon (whether
 * to open OR close the popup).
 *
 * 2026-05-19 v2 spec ("Brakuje ikonki chatu do odpalania malego
 * chatu na popupie jak w party"): clicking the icon toggles a
 * floating mini-chat popover that mirrors the full `/chat` layout.
 * The full-screen `/chat` route is still reachable via Społeczność.
 */
const ChatUnreadBadge = () => {
    // 2026-05-19 v5 spec ("Ikonka chatu powinna byc tylko po wejsciu
    // na postac a nie wczesniej"): bail out before the player has
    // actually entered a character — no character means no chat
    // identity to render with.
    const character = useCharacterStore((s) => s.character);
    // 2026-05-19 v8: also bail on auth / character-select routes
    // even if a `character` is still hydrated from a previous
    // session — the badge shouldn't appear over the character
    // picker.
    const location = useLocation();
    const normalizedPath = location.pathname.replace(/\/+$/, '');
    const onCharacterlessRoute =
        CHARACTERLESS_ROUTES.has(normalizedPath)
        || CHARACTERLESS_ROUTES.has(location.pathname);

    const hasNotification = useChatTabsStore((s) => s.hasNotification);
    const clearNotification = useChatTabsStore((s) => s.clearNotification);

    // Transform-coloured dot (falls back to red). `solid` is preferred
    // over `gradient` so the small dot reads as one clean colour.
    const transformColor = useTransformStore.getState().getHighestTransformColor();
    const dotColor = transformColor?.solid
        ?? transformColor?.gradient?.[0]
        ?? '#f44336';

    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => {
        setOpen((o) => !o);
        // Any click — open OR close — should silence the dot. Spec:
        // "znika jak klikam w ikonke chatu".
        clearNotification();
    }, [clearNotification]);
    const close = useCallback(() => setOpen(false), []);

    // 2026-05-20 spec ("Ikonka chatu powinna zniknac" w trybie offline):
    // chat is a multiplayer-only feature, so the floating bottom-right
    // icon disappears entirely while the player is in offline mode.
    const playMode = useConnectivityStore((s) => s.mode);

    if (!character) return null;
    if (onCharacterlessRoute) return null;
    if (playMode === 'offline') return null;

    return (
        <>
            <button
                type="button"
                className={[
                    'chat-unread-badge',
                    open ? 'chat-unread-badge--open' : '',
                ].filter(Boolean).join(' ')}
                onClick={toggle}
                title={
                    open
                        ? 'Zamknij czat'
                        : hasNotification
                            ? 'Nowa wiadomość'
                            : 'Otwórz czat'
                }
                aria-label="Otwórz czat"
                aria-expanded={open}
            >
                <span className="chat-unread-badge__icon"><GameIcon name="speech-balloon" /></span>
                {hasNotification && !open && (
                    <span
                        className="chat-unread-badge__dot"
                        style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
                        aria-hidden="true"
                    />
                )}
            </button>
            <ChatPopup open={open} onClose={close} />
        </>
    );
};

export default ChatUnreadBadge;
