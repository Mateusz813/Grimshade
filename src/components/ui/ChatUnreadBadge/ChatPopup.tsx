import { useEffect, useRef } from 'react';
import { useCharacterStore } from '../../../stores/characterStore';
import { useChatTabsStore } from '../../../stores/chatTabsStore';
import Chat from '../Chat/Chat';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import './ChatPopup.scss';

/**
 * Floating mini chat popup — opens from the bottom-right chat icon
 * (`ChatUnreadBadge`) and mirrors the layout of the full
 * `/chat` screen at a compact size so the player can read and
 * reply without leaving whatever screen they're on.
 *
 * 2026-05-19 v2 spec ("Brakuje ikonki chatu do odpalania malego
 * chatu na popupie jak w party"): the party widget already does
 * this for `Chat party`; the dedicated chat icon now matches with
 * its own popover for global / guild / party / system / PM tabs.
 *
 * Re-uses the shared `chatTabsStore` so opening the popup, focusing
 * a tab here, and later opening the full `/chat` route all show
 * the same active tab and unread counts. Closes on Escape and on
 * backdrop click.
 */
interface IProps {
    open: boolean;
    onClose: () => void;
}

const ChatPopup = ({ open, onClose }: IProps) => {
    const character = useCharacterStore((s) => s.character);
    const tabs = useChatTabsStore((s) => s.tabs);
    const activeId = useChatTabsStore((s) => s.activeId);
    const ensureCityTab = useChatTabsStore((s) => s.ensureCityTab);
    const ensureSystemTab = useChatTabsStore((s) => s.ensureSystemTab);
    const openPm = useChatTabsStore((s) => s.openPm);
    const closeTab = useChatTabsStore((s) => s.closeTab);
    const setActive = useChatTabsStore((s) => s.setActive);

    useEffect(() => {
        if (!open) return;
        ensureCityTab();
        ensureSystemTab();
    }, [open, ensureCityTab, ensureSystemTab]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    // 2026-05-19 v9 spec ("Click poza chat powinien tez go zamykac"):
    // close the popup when the user mousedowns anywhere outside its
    // panel. The chat-icon itself toggles the popup, so we skip
    // clicks that originate on `.chat-unread-badge` — otherwise the
    // toggle would race with this listener and immediately reopen.
    // We also skip clicks on `.chat__menu` (the portal-rendered nick
    // context menu) so opening "Wyślij PM" / "Zablokuj" etc. doesn't
    // close the popup mid-interaction.
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) return;
            const el = target as HTMLElement;
            if (panelRef.current && panelRef.current.contains(target)) return;
            if (el.closest('.chat-unread-badge')) return;
            if (el.closest('.chat__menu')) return;
            onClose();
        };
        window.addEventListener('mousedown', onMouseDown);
        return () => window.removeEventListener('mousedown', onMouseDown);
    }, [open, onClose]);

    if (!open || !character) return null;

    return (
        <div className="chat-popup" role="dialog" aria-label="Czat" ref={panelRef}>
            <header className="chat-popup__header">
                <span className="chat-popup__title"><GameIcon name="speech-balloon" /> Czat</span>
                <button
                    type="button"
                    className="chat-popup__close"
                    onClick={onClose}
                    aria-label="Zamknij czat"
                >
                    ×
                </button>
            </header>

            <div className="chat-popup__tabs" role="tablist">
                {tabs.map((t) => (
                    <div
                        key={t.id}
                        className={`chat-popup__tab${t.id === activeId ? ' chat-popup__tab--active' : ''}`}
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={t.id === activeId}
                            className="chat-popup__tab-btn"
                            onClick={() => setActive(t.id)}
                            title={t.title}
                        >
                            <span className="chat-popup__tab-title"><EmojiText>{t.title}</EmojiText></span>
                            {t.unread > 0 && (
                                <span className="chat-popup__tab-badge">
                                    {t.unread > 99 ? '99+' : t.unread}
                                </span>
                            )}
                        </button>
                        {t.closable && (
                            <button
                                type="button"
                                className="chat-popup__tab-close"
                                title="Zamknij rozmowę"
                                onClick={() => closeTab(t.id)}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className="chat-popup__chat-wrap">
                {tabs.map((t) => (
                    <Chat
                        key={t.id}
                        channel={t.channel}
                        characterName={character.name}
                        characterClass={character.class}
                        characterLevel={character.level}
                        title={t.title}
                        disableContextMenu={t.type === 'pm'}
                        active={t.id === activeId}
                        fillHeight
                        // 2026-05-19 v11 spec ("Jak na chacie w popupie
                        // klikam kogos nick i napisz prywatna
                        // wiadomosc to nie rob wtedy zadnego redirecta,
                        // bo moge byc na widoku walki z bossem"):
                        // every non-PM tab gets `onOpenPm` so the nick
                        // context menu opens the PM as a new tab IN
                        // THE POPUP instead of falling back to the
                        // default `navigate('/chat?pm=…')`. The player
                        // can stay on Boss / Raid / Dungeon while
                        // firing off a private reply.
                        onOpenPm={t.type !== 'pm' ? (target) => openPm(character.name, target) : undefined}
                    />
                ))}
            </div>
        </div>
    );
};

export default ChatPopup;
