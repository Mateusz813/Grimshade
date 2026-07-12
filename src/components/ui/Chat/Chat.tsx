import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { chatApi, type IMessage } from '../../../api/v1/chatApi';
import { isBackendMode } from '../../../config/backendMode';
import { backendApi } from '../../../api/backend/backendApi';
import { useCharacterStore } from '../../../stores/characterStore';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import { useFriendsStore } from '../../../stores/friendsStore';
import { buildPmChannel } from '../../../api/v1/friendsApi';
import { useGuildStore } from '../../../stores/guildStore';
import { useGuildTagsStore } from '../../../stores/guildTagsStore';
import { parseSystemMessage } from '../../../systems/systemChatMessages';
import { getItemDisplayInfo } from '../../../systems/itemGenerator';
import { getSkillIcon } from '../../../data/skillIcons';
import ItemIcon from '../ItemIcon/ItemIcon';
import TinyIcon from '../TinyIcon/TinyIcon';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import Icon from '../../atoms/Icon/Icon';
import './Chat.scss';


const CLASS_ICONS: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
    Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

interface IChatProps {
    channel: string;
    characterName: string;
    characterClass: string;
    characterLevel: number;
    title?: string;
    maxHeight?: number;
    disableContextMenu?: boolean;
    onOpenPm?: (targetName: string) => void;
    onMessageReceived?: (msg: IMessage) => void;
    active?: boolean;
    fillHeight?: boolean;
    messageCap?: number;
}

interface IContextMenuState {
    x: number;
    y: number;
    targetName: string;
    targetClass: string | null;
    targetLevel: number | null;
}


const formatTime = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const getClassIcon = (cls?: string | null): string => {
    if (!cls) return 'bust-in-silhouette';
    return CLASS_ICONS[cls] ?? 'bust-in-silhouette';
};


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
    messageCap,
}: IChatProps) => {
    const navigate = useNavigate();
    const [messages, setMessages] = useState<IMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [menu, setMenu] = useState<IContextMenuState | null>(null);
    const messagesRef = useRef<HTMLDivElement>(null);

    const isFriend = useFriendsStore((s) => s.isFriend);
    const isBlocked = useFriendsStore((s) => s.isBlocked);
    const addFriend = useFriendsStore((s) => s.addFriend);
    const removeFriend = useFriendsStore((s) => s.removeFriend);
    const blockUser = useFriendsStore((s) => s.blockUser);
    const unblockUser = useFriendsStore((s) => s.unblockUser);

    const ownGuildTag = useGuildStore((s) => s.guild?.tag ?? '');
    const tagsByName = useGuildTagsStore((s) => s.tagsByName);
    const resolveTagsByName = useGuildTagsStore((s) => s.resolveTagsByName);
    useEffect(() => {
        if (messages.length === 0) return;
        const names = Array.from(new Set(
            messages
                .filter((m) => m.character_name !== characterName)
                .map((m) => m.character_name),
        ));
        if (names.length > 0) void resolveTagsByName(names);
    }, [messages, characterName, resolveTagsByName]);

    useEffect(() => {
        chatApi.getMessages(channel, messageCap)
            .then(setMessages)
            .catch(() => setError('Błąd ładowania wiadomości.'));
    }, [channel, messageCap]);

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
                .catch(() => { });
        }, 4000);
        return () => { unsub(); clearInterval(pollId); };
    }, [channel, characterName, onMessageReceived]);

    useEffect(() => {
        if (!active) return;
        const el = messagesRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages, active]);

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
            if (isBackendMode()) {
                const activeCharId = useCharacterStore.getState().character?.id;
                if (activeCharId) {
                    const inserted = await backendApi.chatSend(
                        activeCharId,
                        { channel, content: text },
                    ) as IMessage | null;
                    if (inserted) {
                        setMessages((prev) => {
                            if (prev.some((m) => m.id === inserted.id)) return prev;
                            return [...prev, inserted];
                        });
                    }
                    setInput('');
                    return;
                }
            }
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
            <div className="chat__header">
                <span className="chat__title"><EmojiText>{title}</EmojiText></span>
            </div>

            <div className="chat__messages" ref={messagesRef} style={messagesStyle}>
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
                                    <span className="chat__msg-icon"><GameIcon name={icon} /></span>
                                    <button
                                        type="button"
                                        className={`chat__msg-name${friend ? ' chat__msg-name--friend' : ''}`}
                                        onClick={(e) => openMenu(e, msg)}
                                        disabled={disableContextMenu || isMe}
                                    >
                                        {friend && !isMe && <span className="chat__msg-name-star"><GameIcon name="star" /></span>}
                                        {(() => {
                                            const tag = isMe
                                                ? (ownGuildTag ? `[${ownGuildTag}]` : '')
                                                : (tagsByName[msg.character_name]?.tag ?? '');
                                            return tag ? `${tag} ${msg.character_name}:` : `${msg.character_name}:`;
                                        })()}
                                    </button>
                                    {(() => {
                                        const sys = parseSystemMessage(msg.content);
                                        if (sys && sys.type === 'skillUpgrade') {
                                            const icon = getSkillIcon(sys.skillId);
                                            return (
                                                <span className="chat__msg-text chat__msg-text--system chat__msg-text--skill">
                                                    <span className="chat__msg-sys-icon">
                                                        <TinyIcon icon={icon} size="md" />
                                                    </span>
                                                    <span className="chat__msg-sys-body">
                                                        ulepszył(a) skill{' '}
                                                        <strong>{sys.skillName}</strong>
                                                        {' do '}
                                                        <strong>+{sys.upgradeLevel}</strong>
                                                        !
                                                    </span>
                                                </span>
                                            );
                                        }
                                        if (sys && sys.type === 'upgrade') {
                                            const info = getItemDisplayInfo(sys.itemId);
                                            const icon = info?.icon ?? 'crossed-swords';
                                            return (
                                                <span className={`chat__msg-text chat__msg-text--system chat__msg-text--rarity-${sys.rarity}`}>
                                                    <span className="chat__msg-sys-icon">
                                                        <ItemIcon
                                                            icon={icon}
                                                            rarity={sys.rarity}
                                                            upgradeLevel={sys.upgradeLevel}
                                                            size="sm"
                                                            showTooltip={false}
                                                        />
                                                    </span>
                                                    <span className="chat__msg-sys-body">
                                                        ulepszył(a){' '}
                                                        <strong>{sys.itemName}</strong>
                                                        {' do '}
                                                        <strong>+{sys.upgradeLevel}</strong>
                                                        !
                                                    </span>
                                                </span>
                                            );
                                        }
                                        return <span className="chat__msg-text"><EmojiText>{msg.content}</EmojiText></span>;
                                    })()}
                                </div>
                            );
                        })}
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
                            {sending ? '…' : <Icon name="arrowUp" />}
                        </button>
                    </div>

            {menu && createPortal(
                <div
                    className="chat__menu"
                    style={{ position: 'fixed', left: menu.x, top: menu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="chat__menu-header">
                        <span className="chat__menu-icon"><GameIcon name={getClassIcon(menu.targetClass)} /></span>
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
                            <EmojiText>:multiply: Usuń ze znajomych</EmojiText>
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="chat__menu-item"
                            onClick={() => { addFriend(menu.targetName); setMenu(null); }}
                        >
                            <Icon name="plus" /> Dodaj do znajomych
                        </button>
                    )}
                    <button
                        type="button"
                        className="chat__menu-item"
                        onClick={onSendPm}
                    >
                        <EmojiText>:love-letter: Wyślij prywatną wiadomość</EmojiText>
                    </button>
                    {isBlocked(menu.targetName) ? (
                        <button
                            type="button"
                            className="chat__menu-item chat__menu-item--danger"
                            onClick={() => { unblockUser(menu.targetName); setMenu(null); }}
                        >
                            <GameIcon name="unlocked" /> Odblokuj gracza
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="chat__menu-item chat__menu-item--danger"
                            onClick={() => { blockUser(menu.targetName); setMenu(null); }}
                        >
                            <GameIcon name="prohibited" /> Zablokuj gracza
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
