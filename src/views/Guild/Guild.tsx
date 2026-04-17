import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import './Guild.scss';

/**
 * Guild screen — placeholder view.
 *
 * Real guild multiplayer (Supabase-backed) is not implemented yet. This
 * screen acts as a visual entry point from Town so players can see the
 * feature is planned. Shows a short roadmap + the player's info so the
 * layout feels intentional instead of a blank "coming soon" page.
 */
const Guild = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);

    return (
        <div className="guild">
            <header className="guild__header">
                <button
                    type="button"
                    className="guild__back-btn"
                    onClick={() => navigate('/')}
                >
                    ← Powrót
                </button>
                <h1 className="guild__title">🏛️ Gildia</h1>
            </header>

            <div className="guild__card">
                <div className="guild__icon">🏛️</div>
                <h2 className="guild__card-title">Gildie wkrótce!</h2>
                <p className="guild__card-text">
                    System gildii jest w przygotowaniu. Dołącz wkrótce do
                    społeczności graczy, zdobywaj wspólne nagrody i buduj
                    potężne sojusze.
                </p>

                <div className="guild__features">
                    <div className="guild__feature">
                        <span className="guild__feature-icon">🎖️</span>
                        <div className="guild__feature-content">
                            <div className="guild__feature-name">Ranking gildii</div>
                            <div className="guild__feature-desc">Rywalizuj o pozycję wśród najlepszych</div>
                        </div>
                    </div>
                    <div className="guild__feature">
                        <span className="guild__feature-icon">⚔️</span>
                        <div className="guild__feature-content">
                            <div className="guild__feature-name">Wspólne bossy</div>
                            <div className="guild__feature-desc">Eventy gildyjne i raidy</div>
                        </div>
                    </div>
                    <div className="guild__feature">
                        <span className="guild__feature-icon">💎</span>
                        <div className="guild__feature-content">
                            <div className="guild__feature-name">Skarb gildii</div>
                            <div className="guild__feature-desc">Wspólna pula złota i itemów</div>
                        </div>
                    </div>
                    <div className="guild__feature">
                        <span className="guild__feature-icon">💬</span>
                        <div className="guild__feature-content">
                            <div className="guild__feature-name">Kanał gildii</div>
                            <div className="guild__feature-desc">Osobny chat tylko dla członków</div>
                        </div>
                    </div>
                </div>

                {character && (
                    <div className="guild__player-info">
                        Zalogowany jako <strong>{character.name}</strong> (Lvl {character.level} {character.class})
                    </div>
                )}
            </div>
        </div>
    );
};

export default Guild;
