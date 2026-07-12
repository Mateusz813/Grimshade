import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import { useCharacterStore } from '../../../stores/characterStore';
import { useTransformStore } from '../../../stores/transformStore';
import { useConnectivityStore } from '../../../stores/connectivityStore';
import ChatPopup from './ChatPopup';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './ChatUnreadBadge.scss';

const CHARACTERLESS_ROUTES = new Set<string>([
    '/login',
    '/register',
    '/forgot-password',
    '/character-select',
    '/create-character',
]);

const ChatUnreadBadge = () => {
    const character = useCharacterStore((s) => s.character);
    const location = useLocation();
    const normalizedPath = location.pathname.replace(/\/+$/, '');
    const onCharacterlessRoute =
        CHARACTERLESS_ROUTES.has(normalizedPath)
        || CHARACTERLESS_ROUTES.has(location.pathname);

    const hasNotification = useChatTabsStore((s) => s.hasNotification);
    const clearNotification = useChatTabsStore((s) => s.clearNotification);

    const transformColor = useTransformStore.getState().getHighestTransformColor();
    const dotColor = transformColor?.solid
        ?? transformColor?.gradient?.[0]
        ?? '#f44336';

    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => {
        setOpen((o) => !o);
        clearNotification();
    }, [clearNotification]);
    const close = useCallback(() => setOpen(false), []);

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
