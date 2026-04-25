import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { chatApi, type IMessage } from '../../../api/v1/chatApi';
import { useFriendsStore } from '../../../stores/friendsStore';
import { buildPmChannel } from '../../../api/v1/friendsApi';
import './Chat.scss';

// ── Types ─────────────────────────────────────────────────────────────────────

const CLASS_ICONS: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
    Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

interface IChatProps {
    channel: string;
    characterName: string;
    characterClass: string;
    characterLevel: number;
    title?: string;
    maxHeight?: number;
    /**
     * When true the message row context menu is disabled (used for PM tabs
     * and other places where the extra actions don't make sense).
     */
    disableContextMenu?: boolean;
    /**
     * Optional override for "Wyślij prywatną wiadomość". When provided it's
     * called with the target character name instead of navigating away.
     * GlobalChat passes this to open a new PM tab in place.
     */
    onOpenPm?: (targetName: string) => void;
    /**
     * Fired every time a NEW message arrives via subscription/polling (not
     * historical messages loaded on mount, and not the player's own sends).
     * Used by multi-tab hosts to increment unread counters.
     */
    onMessageReceived?: (msg: IMessage) => void;
    /**
     * When false, the chat is kept mounted but hidden via CSS. Multi-tab
     * containers use this to keep every tab's state (scroll, input, live
     * subscriptions) alive while only displaying the selected one.
     */
    active?: boolean;
    /** When true the chat stretches to fill its parent's available height. */
    fillHeight?: boolean;
}

interface IContextMenuState {
    // Viewport coordinates — the menu is rendered through a portal at
    // document.body with position:fixed so it can't be clipped by the scroll
    // container around the message list.
    x: number;
    y: number;
    targetName: string;
    targetClass: string | null;
    targetLevel: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatTime = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const getClassIcon = (cls?: string | null): string => {
    if (!cls) return '👤';
    return CLASS_ICONS[cls] ?? '👤';
};

// ── Component ─────────────────────────────────────────────────────────────────

const Chat = ({
    channel,
    characterName,
    characterClass,
    characterLevel,
    title = 'Chat',
    maxHeight = 240,
    disableContextMenu = false,
    onOpenPm,
    onMessageReceived,
    active = true,
    fillHeight = false,
}: IChatProps) => {
    const navigate = useNavigate();
    const [messages, setMessages] = useState<IMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [menu, setMenu] = useState<IContextMenuState | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    const isFriend = useFriendsStore((s) => s.isFriend);
    const isBlocked = useFriendsStore((s) => s.isBlocked);
    const addFriend = useFriendsStore((s) => s.addFriend);
    const removeFriend = useFriendsStore((s) => s.removeFriend);
    const blockUser = useFriendsStore((s) => s.blockUser);
    const unblockUser = useFriendsStore((s) => s.unblockUser);

    // Load initial messages
    useEffect(() => {
        chatApi.getMessages(channel)
            .then(setMessages)
            .catch(() => setError('Błąd ładowania wiadomości.'));
    }, [channel]);

    // Subscribe to Realtime + poll as a fallback in case the `messages` table
    // isn't in the supabase_realtime publication on this instance. Both paths
    // dedupe by id, so having them run together is safe.
    useEffect(() => {
        const notifyIfNew = (msg: IMessage) => {
            if (msg.character_name === characterName) return;
            onMessageReceived?.(msg);
        };
        const unsub = chatApi.subscribe(channel, (msg) => {
            setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
                notifyIfNew(msg);
                return [...prev, msg];
            });
        });
        const pollId = setInterval(() => {
            chatApi.getMessages(channel)
                .then((fresh) => {
                    setMessages((prev) => {
                        const seen = new Set(prev.map((m) => m.id));
                        const merged = [...prev];
                        for (const m of fresh) {
                            if (!seen.has(m.id)) {
                                merged.push(m);
                                notifyIfNew(m);
                            }
                        }
                        return merged;
                    });
                })
                .catch(() => { /* offline – skip tick */ });
        }, 4000);
        return () => { unsub(); clearInterval(pollId); };
    }, [channel, characterName, onMessageReceived]);

    // Auto-scroll to bottom — only when active so hidden tabs don't thrash
    // scrollIntoView on every background message.
    useEffect(() => {
        if (!active) return;
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, active]);

    // Close context menu on outside click / Escape
    useEffect(() => {
        if (!menu) return;
        const onClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.closest('.chat__menu')) return;
            setMenu(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMenu(null);
        };
        window.addEventListener('mousedown', onClick);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onClick);
            window.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || sending) return;
        setSending(true);
        setError(null);
        try {
            const inserted = await chatApi.sendMessage(channel, text, characterName, characterClass, characterLevel);
            if (inserted) {
                setMessages((prev) => {
                    if (prev.some((m) => m.id === inserted.id)) return prev;
                    return [...prev, inserted];
                });
            }
            setInput('');
        } catch {
            setError('Nie udało się wysłać wiadomości.');
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    const openMenu = (
        e: React.MouseEvent | React.TouchEvent,
        msg: IMessage,
    ) => {
        if (disableContextMenu) return;
        if (msg.character_name === characterName) return;
        e.preventDefault();
        // Anchor to the clicked target — coordinates are viewport-relative and
        // consumed by the portal-rendered menu (position:fixed), so the menu
        // never gets clipped by the message list's scroll container.
        const clientX = 'touches' in e
            ? (e.touches[0]?.clientX ?? 40)
            : e.clientX;
        const clientY = 'touches' in e
            ? (e.touches[0]?.clientY ?? 40)
            : e.clientY;
        setMenu({
            x: clientX,
            y: clientY,
            targetName: msg.character_name,
            targetClass: msg.character_class ?? null,
            targetLevel: msg.character_level ?? null,
        });
    };

    const onSendPm = () => {
        if (!menu) return;
        const target = menu.targetName;
        setMenu(null);
        if (onOpenPm) {
            onOpenPm(target);
            return;
        }
        navigate(`/chat?pm=${encodeURIComponent(target)}`);
    };

    // ── Render ────────────────────────────────────────────────────────────────

    const rootStyle: React.CSSProperties = {};
    if (!active) rootStyle.display = 'none';
    if (fillHeight) {
        rootStyle.height = '100%';
        rootStyle.display = active ? 'flex' : 'none';
        rootStyle.flexDirection = 'column';
    }

    const messagesStyle: React.CSSProperties = fillHeight
        ? { flex: 1, minHeight: 0, maxHeight: 'none' }
        : { maxHeight };

    return (
        <div className={`chat${fillHeight ? ' chat--fill' : ''}`} style={rootStyle}>
            <div className="chat__header" onClick={() => setCollapsed((c) => !c)}>
                <span className="chat__title">{title}</span>
                <span className="chat__toggle">{collapsed ? '▲' : '▼'}</span>
            </div>

            {!collapsed && (
                <>
                    <div className="chat__messages" style={messagesStyle}>
                        {messages.length === 0 && (
                            <p className="chat__empty">Brak wiadomości. Napisz pierwszy!</p>
                        )}
                        {messages.map((msg) => {
                            if (isBlocked(msg.character_name) && msg.character_name !== characterName) {
                                return null;
                            }
                            const isMe = msg.character_name === characterName;
                            const icon = getClassIcon(msg.character_class ?? (isMe ? characterClass : null));
                            const level = msg.character_level ?? (isMe ? characterLevel : null);
                            const friend = isFriend(msg.character_name);
                            return (
                                <div
                                    key={msg.id}
                                    className={`chat__msg${isMe ? ' chat__msg--me' : ''}`}
                                    onContextMenu={(e) => openMenu(e, msg)}
                                >
                                    <span className="chat__msg-time">{formatTime(msg.created_at)}</span>
                                    {level !== null && (
                                        <span className="chat__msg-level" title={`Poziom ${level}`}>
                                            {level}
                                        </span>
                                    )}
                                    <span className="chat__msg-icon">{icon}</span>
                                    <button
                                        type="button"
                                        className={`chat__msg-name${friend ? ' chat__msg-name--friend' : ''}`}
                                        onClick={(e) => openMenu(e, msg)}
                                        disabled={disableContextMenu || isMe}
                                    >
                                        {friend && !isMe && <span className="chat__msg-name-star">★</span>}
                                        {msg.character_name}:
                                    </button>
                                    <span className="chat__msg-text">{msg.content}</span>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>

                    {error && <p className="chat__error">{error}</p>}

                    <div className="chat__input-row">
                        <input
                            className="chat__input"
                            placeholder="Napisz wiadomość..."
                            value={input}
                            maxLength={300}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={sending}
                        />
                        <button
                            className="chat__send"
                            onClick={handleSend}
                            disabled={sending || !input.trim()}
                        >
                            {sending ? '…' : '↑'}
                        </button>
                    </div>
                </>
            )}

            {menu && createPortal(
                <div
                    className="chat__menu"
                    style={{ position: 'fixed', left: menu.x, top: menu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="chat__menu-header">
                        <span className="chat__menu-icon">{getClassIcon(menu.targetClass)}</span>
                        <span className="chat__menu-name">{menu.targetName}</span>
                        {menu.targetLevel !== null && (
                            <span className="chat__menu-level">Lv {menu.targetLevel}</span>
                        )}
                    </div>
                    {isFriend(menu.targetName) ? (
                        <button
                            type="button"
                            className="chat__menu-item"
                            onClick={() => { removeFriend(menu.targetName); setMenu(null); }}
                        >
                            ✖ Usuń ze znajomych
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="chat__menu-item"
                            onClick={() => { addFriend(menu.targetName); setMenu(null); }}
                        >
                            ➕ Dodaj do znajomych
                        </button>
                    )}
                    <button
                        type="button"
                        className="chat__menu-item"
                        onClick={onSendPm}
                    >
                        💌 Wyślij prywatną wiadomość
                    </button>
                    {isBlocked(menu.targetName) ? (
                        <button
                            type="button"
                            className="chat__menu-item chat__menu-item--danger"
                            onClick={() => { unblockUser(menu.targetName); setMenu(null); }}
                        >
                            🔓 Odblokuj gracza
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="chat__menu-item chat__menu-item--danger"
                            onClick={() => { blockUser(menu.targetName); setMenu(null); }}
                        >
                            🚫 Zablokuj gracza
                        </button>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
};

export { buildPmChannel };
export default Chat;
