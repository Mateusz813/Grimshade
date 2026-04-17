import { useState, useEffect, useRef } from 'react';
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
     * When true the message row context menu is disabled (used for party chat
     * where members are already friends by being in the party, or for PM).
     */
    disableContextMenu?: boolean;
}

interface IContextMenuState {
    visible: boolean;
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
}: IChatProps) => {
    const navigate = useNavigate();
    const [messages, setMessages] = useState<IMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [menu, setMenu] = useState<IContextMenuState | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);

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
        const unsub = chatApi.subscribe(channel, (msg) => {
            setMessages((prev) => {
                if (prev.some((m) => m.id === msg.id)) return prev;
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
                            if (!seen.has(m.id)) merged.push(m);
                        }
                        return merged;
                    });
                })
                .catch(() => { /* offline – skip tick */ });
        }, 4000);
        return () => { unsub(); clearInterval(pollId); };
    }, [channel]);

    // Auto-scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

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
            // Push the inserted row into local state immediately so the sender
            // sees their own message without waiting for the Realtime
            // postgres_changes round-trip. The subscription dedupes by id so
            // the live event won't create a duplicate.
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
        const container = messagesRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const clientX = 'touches' in e
            ? (e.touches[0]?.clientX ?? rect.left + 40)
            : e.clientX;
        const clientY = 'touches' in e
            ? (e.touches[0]?.clientY ?? rect.top + 40)
            : e.clientY;
        setMenu({
            visible: true,
            x: clientX - rect.left,
            y: clientY - rect.top,
            targetName: msg.character_name,
            targetClass: msg.character_class ?? null,
            targetLevel: msg.character_level ?? null,
        });
    };

    const onSendPm = () => {
        if (!menu) return;
        const target = menu.targetName;
        setMenu(null);
        navigate(`/friends?pm=${encodeURIComponent(target)}`);
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="chat">
            <div className="chat__header" onClick={() => setCollapsed((c) => !c)}>
                <span className="chat__title">{title}</span>
                <span className="chat__toggle">{collapsed ? '▲' : '▼'}</span>
            </div>

            {!collapsed && (
                <>
                    <div ref={messagesRef} className="chat__messages" style={{ maxHeight }}>
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

                        {menu && (
                            <div
                                className="chat__menu"
                                style={{ left: menu.x, top: menu.y }}
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
                            </div>
                        )}
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
        </div>
    );
};

export { buildPmChannel };
export default Chat;
