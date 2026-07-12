import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useChatTabsStore } from '../../stores/chatTabsStore';
import Chat from '../../components/ui/Chat/Chat';
import Spinner from '../../components/ui/Spinner/Spinner';
import EmojiText from '../../components/atoms/Twemoji/EmojiText';
import './GlobalChat.scss';

const GlobalChat = () => {
    const location = useLocation();
    const character = useCharacterStore((s) => s.character);

    const tabs = useChatTabsStore((s) => s.tabs);
    const activeId = useChatTabsStore((s) => s.activeId);
    const ensureCityTab = useChatTabsStore((s) => s.ensureCityTab);
    const ensureSystemTab = useChatTabsStore((s) => s.ensureSystemTab);
    const openPm = useChatTabsStore((s) => s.openPm);
    const closeTab = useChatTabsStore((s) => s.closeTab);
    const setActive = useChatTabsStore((s) => s.setActive);

    useEffect(() => {
        ensureCityTab();
        ensureSystemTab();
    }, [ensureCityTab, ensureSystemTab]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const target = params.get('pm');
        if (target && character) openPm(character.name, target);
    }, [location.search, character, openPm]);

    const handleOpenPm = useCallback((target: string) => {
        if (!character) return;
        openPm(character.name, target);
    }, [character, openPm]);

    if (!character) {
        return (
            <div className="global-chat">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="global-chat">
            <div className="global-chat__tabs" role="tablist">
                {tabs.map((t) => (
                    <div
                        key={t.id}
                        className={`global-chat__tab${t.id === activeId ? ' global-chat__tab--active' : ''}`}
                    >
                        <button
                            type="button"
                            role="tab"
                            aria-selected={t.id === activeId}
                            className="global-chat__tab-btn"
                            onClick={() => setActive(t.id)}
                        >
                            <span className="global-chat__tab-title"><EmojiText>{t.title}</EmojiText></span>
                            {t.unread > 0 && (
                                <span className="global-chat__tab-badge">{t.unread > 99 ? '99+' : t.unread}</span>
                            )}
                        </button>
                        {t.closable && (
                            <button
                                type="button"
                                className="global-chat__tab-close"
                                title="Zamknij rozmowę"
                                onClick={() => closeTab(t.id)}
                            >
                                ×
                            </button>
                        )}
                    </div>
                ))}
            </div>

            <div className="global-chat__chat-wrap">
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
                        onOpenPm={t.type !== 'pm' ? handleOpenPm : undefined}
                    />
                ))}
            </div>
        </div>
    );
};

export default GlobalChat;
