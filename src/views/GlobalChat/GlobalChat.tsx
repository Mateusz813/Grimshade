import { useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useChatTabsStore } from '../../stores/chatTabsStore';
import Chat from '../../components/ui/Chat/Chat';
import './GlobalChat.scss';

/**
 * Global chat screen — dedicated full-screen view with tab support.
 *
 * The city tab is always open. Opening a PM via the message context menu
 * (Wyślij prywatną wiadomość) adds a new tab instead of navigating away,
 * so multiple PM conversations can be kept open at once. Tabs track unread
 * message counts; inactive tabs show a badge when someone writes.
 */
const GlobalChat = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const character = useCharacterStore((s) => s.character);

    const tabs = useChatTabsStore((s) => s.tabs);
    const activeId = useChatTabsStore((s) => s.activeId);
    const ensureCityTab = useChatTabsStore((s) => s.ensureCityTab);
    const openPm = useChatTabsStore((s) => s.openPm);
    const closeTab = useChatTabsStore((s) => s.closeTab);
    const setActive = useChatTabsStore((s) => s.setActive);

    useEffect(() => { ensureCityTab(); }, [ensureCityTab]);

    // Support `?pm=<Name>` deep-links (e.g. from an older Friends shortcut).
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
                <p className="global-chat__loading">Ładowanie...</p>
            </div>
        );
    }

    return (
        <div className="global-chat">
            <header className="global-chat__header page-header">
                <button
                    type="button"
                    className="global-chat__back-btn page-back-btn"
                    onClick={() => navigate('/')}
                >
                    ← Miasto
                </button>
                <h1 className="global-chat__title page-title">💬 Chat</h1>
            </header>

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
                            <span className="global-chat__tab-title">{t.title}</span>
                            {t.unread > 0 && (
                                <span className="global-chat__tab-badge">{t.unread > 99 ? '99+' : t.unread}</span>
                            )}
                        </button>
                        {t.type === 'pm' && (
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
                        onOpenPm={t.type === 'city' ? handleOpenPm : undefined}
                    />
                ))}
            </div>
        </div>
    );
};

export default GlobalChat;
