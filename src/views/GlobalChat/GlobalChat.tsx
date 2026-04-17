import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import Chat from '../../components/ui/Chat/Chat';
import './GlobalChat.scss';

/**
 * Global chat screen — dedicated full-screen view over the city chat channel.
 * Reuses the shared Chat component (Supabase Realtime) with a larger height.
 */
const GlobalChat = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);

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
                    ← Powrót
                </button>
                <h1 className="global-chat__title page-title">💬 Chat miasta</h1>
            </header>

            <p className="global-chat__hint">
                Rozmawiaj z innymi graczami w całym mieście. Wiadomości są
                synchronizowane na żywo przez Supabase Realtime.
            </p>

            <div className="global-chat__chat-wrap">
                <Chat
                    channel="city"
                    characterName={character.name}
                    characterClass={character.class}
                    characterLevel={character.level}
                    title="🌆 Miasto"
                    maxHeight={520}
                />
            </div>
        </div>
    );
};

export default GlobalChat;
