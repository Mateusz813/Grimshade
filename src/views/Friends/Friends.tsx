import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useFriendsStore } from '../../stores/friendsStore';
import { friendsApi, buildPmChannel, type IFriendCharacterInfo } from '../../api/v1/friendsApi';
import Chat from '../../components/ui/Chat/Chat';
import './Friends.scss';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CLASS_ICONS: Record<string, string> = {
    Knight: '⚔️', Mage: '🔮', Cleric: '✨', Archer: '🏹',
    Rogue: '🗡️', Necromancer: '💀', Bard: '🎵',
};

type TTab = 'friends' | 'blocked' | 'pm';

/**
 * Friends screen — social hub for each character.
 *
 * Features:
 *   - Add friend by exact character name (queries Supabase `characters`)
 *   - Friends list with live online status (character updated in last 5 min)
 *   - Favorite (pin) friends to the top
 *   - Block list with unblock flow
 *   - 1:1 private messages using a deterministic PM channel that both sides
 *     end up subscribed to (via buildPmChannel)
 *
 * The friends graph itself (names, favorites, blocked) is persisted locally
 * per character via characterScope. PM uses the real Supabase chat pipeline.
 */
const Friends = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const character = useCharacterStore((s) => s.character);

    const friends = useFriendsStore((s) => s.friends);
    const favorites = useFriendsStore((s) => s.favorites);
    const blocked = useFriendsStore((s) => s.blocked);
    const addFriend = useFriendsStore((s) => s.addFriend);
    const removeFriend = useFriendsStore((s) => s.removeFriend);
    const toggleFavorite = useFriendsStore((s) => s.toggleFavorite);
    const blockUser = useFriendsStore((s) => s.blockUser);
    const unblockUser = useFriendsStore((s) => s.unblockUser);
    const isFavorite = useFriendsStore((s) => s.isFavorite);

    const [tab, setTab] = useState<TTab>('friends');
    const [query, setQuery] = useState('');
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [lookupResult, setLookupResult] = useState<IFriendCharacterInfo | null>(null);
    const [looking, setLooking] = useState(false);

    const [infoByName, setInfoByName] = useState<Record<string, IFriendCharacterInfo>>({});
    const [loadingInfo, setLoadingInfo] = useState(false);
    const [pmTarget, setPmTarget] = useState<string | null>(null);
    const openPmFromQuery = useRef(searchParams.get('pm'));

    // ── Load character info for all friends on mount / friends change ─────────

    const refreshFriendsInfo = useCallback(async () => {
        if (!friends.length) {
            setInfoByName({});
            return;
        }
        setLoadingInfo(true);
        try {
            const rows = await friendsApi.findManyByName(friends);
            const next: Record<string, IFriendCharacterInfo> = {};
            for (const row of rows) next[row.name] = row;
            setInfoByName(next);
        } catch {
            /* swallow — stale info is fine */
        } finally {
            setLoadingInfo(false);
        }
    }, [friends]);

    useEffect(() => {
        void refreshFriendsInfo();
        // Refresh online status every 60s while the screen is mounted.
        const id = setInterval(() => { void refreshFriendsInfo(); }, 60000);
        return () => clearInterval(id);
    }, [refreshFriendsInfo]);

    // ── Deep-link: ?pm=Nick → open PM tab for that nick ───────────────────────

    useEffect(() => {
        const nick = openPmFromQuery.current;
        if (!nick) return;
        openPmFromQuery.current = null;
        setPmTarget(nick);
        setTab('pm');
        // Clear the param so back/forward doesn't re-open automatically.
        const next = new URLSearchParams(searchParams);
        next.delete('pm');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    // ── Actions ───────────────────────────────────────────────────────────────

    const doLookup = async () => {
        const name = query.trim();
        setLookupError(null);
        setLookupResult(null);
        if (!name) return;
        if (character && name === character.name) {
            setLookupError('Nie możesz dodać samego siebie.');
            return;
        }
        setLooking(true);
        try {
            const row = await friendsApi.findByName(name);
            if (!row) {
                setLookupError(`Nie znaleziono gracza "${name}".`);
                return;
            }
            setLookupResult(row);
        } catch {
            setLookupError('Błąd wyszukiwania. Spróbuj ponownie.');
        } finally {
            setLooking(false);
        }
    };

    const confirmAdd = () => {
        if (!lookupResult) return;
        addFriend(lookupResult.name);
        setInfoByName((prev) => ({ ...prev, [lookupResult.name]: lookupResult }));
        setLookupResult(null);
        setQuery('');
    };

    const onRemove = (name: string) => {
        removeFriend(name);
        setInfoByName((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
        });
    };

    const openPm = (name: string) => {
        setPmTarget(name);
        setTab('pm');
    };

    const sortedFriends = useMemo(() => {
        return [...friends].sort((a, b) => {
            const aFav = favorites.includes(a) ? 0 : 1;
            const bFav = favorites.includes(b) ? 0 : 1;
            if (aFav !== bFav) return aFav - bFav;
            const aOnline = infoByName[a]?.online ? 0 : 1;
            const bOnline = infoByName[b]?.online ? 0 : 1;
            if (aOnline !== bOnline) return aOnline - bOnline;
            return a.localeCompare(b);
        });
    }, [friends, favorites, infoByName]);

    if (!character) {
        return (
            <div className="friends">
                <p className="friends__loading">Ładowanie...</p>
            </div>
        );
    }

    const pmChannel = pmTarget ? buildPmChannel(character.name, pmTarget) : null;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className="friends">
            <header className="friends__header">
                <button
                    type="button"
                    className="friends__back-btn"
                    onClick={() => navigate('/')}
                >
                    ← Powrót
                </button>
                <h1 className="friends__title">👥 Znajomi</h1>
            </header>

            <div className="friends__tabs">
                <button
                    type="button"
                    className={`friends__tab${tab === 'friends' ? ' friends__tab--active' : ''}`}
                    onClick={() => setTab('friends')}
                >
                    Znajomi ({friends.length})
                </button>
                <button
                    type="button"
                    className={`friends__tab${tab === 'blocked' ? ' friends__tab--active' : ''}`}
                    onClick={() => setTab('blocked')}
                >
                    Zablokowani ({blocked.length})
                </button>
                <button
                    type="button"
                    className={`friends__tab${tab === 'pm' ? ' friends__tab--active' : ''}`}
                    onClick={() => setTab('pm')}
                    disabled={!pmTarget}
                >
                    💌 PM {pmTarget ? `(${pmTarget})` : ''}
                </button>
            </div>

            {tab === 'friends' && (
                <>
                    <section className="friends__add">
                        <h2 className="friends__section-title">Dodaj znajomego</h2>
                        <div className="friends__add-row">
                            <input
                                className="friends__add-input"
                                type="text"
                                placeholder="Wpisz dokładny nick gracza..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') void doLookup(); }}
                                maxLength={40}
                            />
                            <button
                                type="button"
                                className="friends__add-btn"
                                onClick={doLookup}
                                disabled={looking || !query.trim()}
                            >
                                {looking ? '…' : '🔍 Szukaj'}
                            </button>
                        </div>
                        {lookupError && <p className="friends__error">{lookupError}</p>}
                        {lookupResult && (
                            <div className="friends__lookup-result">
                                <span className="friends__lookup-icon">
                                    {CLASS_ICONS[lookupResult.class] ?? '👤'}
                                </span>
                                <div className="friends__lookup-info">
                                    <div className="friends__lookup-name">{lookupResult.name}</div>
                                    <div className="friends__lookup-meta">
                                        Lv {lookupResult.level} {lookupResult.class}
                                        {lookupResult.online && <span className="friends__dot friends__dot--online" />}
                                        {!lookupResult.online && <span className="friends__dot friends__dot--offline" />}
                                        {lookupResult.online ? 'online' : 'offline'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="friends__lookup-add"
                                    onClick={confirmAdd}
                                >
                                    ➕ Dodaj
                                </button>
                            </div>
                        )}
                    </section>

                    <section className="friends__list">
                        <h2 className="friends__section-title">
                            Twoi znajomi {loadingInfo && <span className="friends__muted">(odświeżanie…)</span>}
                        </h2>
                        {sortedFriends.length === 0 && (
                            <div className="friends__empty-list">
                                <div className="friends__empty-list-title">Pusta lista</div>
                                <div className="friends__empty-list-hint">
                                    Dodaj gracza po nicku powyżej, albo kliknij nick w czacie miasta.
                                </div>
                            </div>
                        )}
                        {sortedFriends.map((name) => {
                            const info = infoByName[name];
                            const fav = isFavorite(name);
                            return (
                                <div key={name} className="friends__row">
                                    <button
                                        type="button"
                                        className={`friends__row-star${fav ? ' friends__row-star--on' : ''}`}
                                        onClick={() => toggleFavorite(name)}
                                        title={fav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
                                    >
                                        {fav ? '★' : '☆'}
                                    </button>
                                    <span className="friends__row-icon">
                                        {info ? (CLASS_ICONS[info.class] ?? '👤') : '👤'}
                                    </span>
                                    <div className="friends__row-info">
                                        <div className="friends__row-name">{name}</div>
                                        <div className="friends__row-meta">
                                            {info
                                                ? `Lv ${info.level} ${info.class}`
                                                : 'Brak danych — postać nieaktywna'}
                                        </div>
                                    </div>
                                    <span
                                        className={`friends__row-status${info?.online ? ' friends__row-status--online' : ''}`}
                                    >
                                        <span className={`friends__dot friends__dot--${info?.online ? 'online' : 'offline'}`} />
                                        {info?.online ? 'online' : 'offline'}
                                    </span>
                                    <div className="friends__row-actions">
                                        <button
                                            type="button"
                                            className="friends__action friends__action--pm"
                                            onClick={() => openPm(name)}
                                            title="Wyślij prywatną wiadomość"
                                        >
                                            💌
                                        </button>
                                        <button
                                            type="button"
                                            className="friends__action friends__action--block"
                                            onClick={() => blockUser(name)}
                                            title="Zablokuj gracza"
                                        >
                                            🚫
                                        </button>
                                        <button
                                            type="button"
                                            className="friends__action friends__action--remove"
                                            onClick={() => onRemove(name)}
                                            title="Usuń znajomego"
                                        >
                                            ✖
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </section>
                </>
            )}

            {tab === 'blocked' && (
                <section className="friends__list">
                    <h2 className="friends__section-title">Zablokowani gracze</h2>
                    {blocked.length === 0 && (
                        <div className="friends__empty-list">
                            <div className="friends__empty-list-title">Lista jest pusta</div>
                            <div className="friends__empty-list-hint">
                                Zablokowani gracze nie pojawiają się w czacie miasta.
                            </div>
                        </div>
                    )}
                    {blocked.map((name) => (
                        <div key={name} className="friends__row friends__row--blocked">
                            <span className="friends__row-icon">🚫</span>
                            <div className="friends__row-info">
                                <div className="friends__row-name">{name}</div>
                                <div className="friends__row-meta">Wiadomości ukryte</div>
                            </div>
                            <button
                                type="button"
                                className="friends__action friends__action--unblock"
                                onClick={() => unblockUser(name)}
                            >
                                🔓 Odblokuj
                            </button>
                        </div>
                    ))}
                </section>
            )}

            {tab === 'pm' && pmTarget && pmChannel && (
                <section className="friends__pm">
                    <div className="friends__pm-header">
                        <span className="friends__pm-icon">💌</span>
                        <div className="friends__pm-title">Prywatna wiadomość — {pmTarget}</div>
                        <button
                            type="button"
                            className="friends__pm-close"
                            onClick={() => { setPmTarget(null); setTab('friends'); }}
                        >
                            ✖
                        </button>
                    </div>
                    <Chat
                        channel={pmChannel}
                        characterName={character.name}
                        characterClass={character.class}
                        characterLevel={character.level}
                        title={`Czat z ${pmTarget}`}
                        maxHeight={480}
                        disableContextMenu
                    />
                </section>
            )}

            {tab === 'pm' && !pmTarget && (
                <section className="friends__list">
                    <div className="friends__empty-list">
                        <div className="friends__empty-list-title">Wybierz rozmówcę</div>
                        <div className="friends__empty-list-hint">
                            Kliknij 💌 przy znajomym, żeby otworzyć prywatny czat.
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
};

export default Friends;
