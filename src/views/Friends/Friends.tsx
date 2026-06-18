import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useFriendsStore } from '../../stores/friendsStore';
import { useChatTabsStore } from '../../stores/chatTabsStore';
import { friendsApi, type IFriendCharacterInfo } from '../../api/v1/friendsApi';
import Spinner from '../../components/ui/Spinner/Spinner';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import Icon from '../../components/atoms/Icon/Icon';
import './Friends.scss';

// -- Helpers -------------------------------------------------------------------

const CLASS_ICONS: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
    Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};

type TTab = 'friends' | 'blocked';

/**
 * Confirmation popup spec — a single union shape so the modal can
 * render any of the 3 destructive flows (remove friend, block,
 * unblock from blocked tab) without juggling four separate `useState`
 * slots. `null` means no popup is open. The action labels live in
 * the popup itself so the open-site call stays one line.
 */
type TConfirm =
    | { kind: 'remove'; name: string }
    | { kind: 'block'; name: string }
    | { kind: 'unblock'; name: string }
    | null;

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
    const character = useCharacterStore((s) => s.character);
    const openPmTab = useChatTabsStore((s) => s.openPm);

    const friends = useFriendsStore((s) => s.friends);
    const favorites = useFriendsStore((s) => s.favorites);
    const blocked = useFriendsStore((s) => s.blocked);
    const addFriend = useFriendsStore((s) => s.addFriend);
    const removeFriend = useFriendsStore((s) => s.removeFriend);
    const toggleFavorite = useFriendsStore((s) => s.toggleFavorite);
    const blockUser = useFriendsStore((s) => s.blockUser);
    const unblockUser = useFriendsStore((s) => s.unblockUser);
    const isFavorite = useFriendsStore((s) => s.isFavorite);
    const isBlocked = useFriendsStore((s) => s.isBlocked);
    const isFriend = useFriendsStore((s) => s.isFriend);

    const [tab, setTab] = useState<TTab>('friends');
    const [query, setQuery] = useState('');
    const [lookupError, setLookupError] = useState<string | null>(null);
    const [lookupResult, setLookupResult] = useState<IFriendCharacterInfo | null>(null);
    const [looking, setLooking] = useState(false);
    // 2026-05-19 spec ("na błocka i kasowanie znajomego dodatkowy
    // popup czy chcemy na pewno to zrobić"): one slot drives every
    // destructive-confirmation modal in this view.
    const [confirm, setConfirm] = useState<TConfirm>(null);

    const [infoByName, setInfoByName] = useState<Record<string, IFriendCharacterInfo>>({});
    const [loadingInfo, setLoadingInfo] = useState(false);

    // -- Load character info for all friends on mount / friends change ---------

    const refreshFriendsInfo = useCallback(async () => {
        // Look up BOTH friends + blocked so we can hide names whose character
        // no longer exists (deleted) from either list.
        const names = [...new Set([...friends, ...blocked])];
        if (!names.length) {
            setInfoByName({});
            return;
        }
        setLoadingInfo(true);
        try {
            const rows = await friendsApi.findManyByName(names);
            const next: Record<string, IFriendCharacterInfo> = {};
            for (const row of rows) next[row.name] = row;
            setInfoByName(next);
        } catch {
            /* swallow — stale info is fine */
        } finally {
            setLoadingInfo(false);
        }
    }, [friends, blocked]);

    useEffect(() => {
        void refreshFriendsInfo();
        // Refresh online status every 60s while the screen is mounted.
        const id = setInterval(() => { void refreshFriendsInfo(); }, 60000);
        return () => clearInterval(id);
    }, [refreshFriendsInfo]);

    // -- Actions ---------------------------------------------------------------

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

    // 2026-05-19: remove-friend confirmation handler.
    const handleConfirmedRemove = (name: string) => {
        removeFriend(name);
        setInfoByName((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
        });
        setConfirm(null);
    };

    const handleConfirmedBlock = (name: string) => {
        blockUser(name);
        setConfirm(null);
    };

    const handleConfirmedUnblock = (name: string) => {
        unblockUser(name);
        setConfirm(null);
    };

    const openPm = (name: string) => {
        if (!character) return;
        openPmTab(character.name, name);
        navigate('/chat');
    };

    // Case-insensitive view over infoByName: local friend/blocked names are
    // stored as typed, but the API echoes the character's canonical casing, so
    // a direct `infoByName[n]` lookup would miss (and wrongly hide) a LIVE
    // friend added with different capitalisation. Look up by lowercase key.
    const infoIndex = useMemo(() => {
        const idx: Record<string, IFriendCharacterInfo> = {};
        for (const key of Object.keys(infoByName)) idx[key.toLowerCase()] = infoByName[key];
        return idx;
    }, [infoByName]);
    const infoFor = useCallback(
        (name: string): IFriendCharacterInfo | undefined => infoByName[name] ?? infoIndex[name.toLowerCase()],
        [infoByName, infoIndex],
    );

    // After a successful lookup, hide names whose character no longer exists
    // (deleted -> not returned by findManyByName). Guarded: while loading OR if
    // the lookup returned nothing (offline / fetch error) we show everything,
    // so a network blip never hides live friends.
    const lookupReady = !loadingInfo && Object.keys(infoByName).length > 0;

    const sortedFriends = useMemo(() => {
        const base = lookupReady ? friends.filter((n) => infoFor(n)) : friends;
        return [...base].sort((a, b) => {
            const aFav = favorites.includes(a) ? 0 : 1;
            const bFav = favorites.includes(b) ? 0 : 1;
            if (aFav !== bFav) return aFav - bFav;
            const aOnline = infoFor(a)?.online ? 0 : 1;
            const bOnline = infoFor(b)?.online ? 0 : 1;
            if (aOnline !== bOnline) return aOnline - bOnline;
            return a.localeCompare(b);
        });
    }, [friends, favorites, infoFor, lookupReady]);

    // Same deleted-character pruning for the blocked tab.
    const visibleBlocked = useMemo(
        () => (lookupReady ? blocked.filter((n) => infoFor(n)) : blocked),
        [blocked, infoFor, lookupReady],
    );

    if (!character) {
        return (
            <div className="friends">
                <Spinner size="lg" />
            </div>
        );
    }

    // -- Confirm-modal copy ---------------------------------------------------
    // Resolves the modal's title / body / button label from the union shape.
    // Keeps the JSX render-block free of switch-case sprawl.
    const confirmCopy = (() => {
        if (!confirm) return null;
        if (confirm.kind === 'remove') {
            return {
                title: 'Usuń znajomego',
                body: `Na pewno chcesz usunąć "${confirm.name}" z listy znajomych?`,
                cta: 'Usuń',
                ctaClass: 'friends__confirm-btn--danger',
                onConfirm: () => handleConfirmedRemove(confirm.name),
            };
        }
        if (confirm.kind === 'block') {
            return {
                title: 'Zablokuj gracza',
                body:
                    `Na pewno chcesz zablokować "${confirm.name}"? ` +
                    'Nie zobaczysz jego wiadomości na czacie, ale ' +
                    'pozostanie na liście znajomych — możesz dalej do niego pisać.',
                cta: 'Zablokuj',
                ctaClass: 'friends__confirm-btn--danger',
                onConfirm: () => handleConfirmedBlock(confirm.name),
            };
        }
        return {
            title: 'Odblokuj gracza',
            body: isFriend(confirm.name)
                ? `Odblokować "${confirm.name}"? Znów zobaczysz jego wiadomości. ` +
                  'Pozostaje na Twojej liście znajomych.'
                : `Odblokować "${confirm.name}"? Znów zobaczysz jego wiadomości.`,
            cta: 'Odblokuj',
            ctaClass: 'friends__confirm-btn--primary',
            onConfirm: () => handleConfirmedUnblock(confirm.name),
        };
    })();

    // -- Render ----------------------------------------------------------------

    return (
        <div className="friends">
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
                                {looking ? '…' : <><GameIcon name="magnifying-glass-tilted-left" /> Szukaj</>}
                            </button>
                        </div>
                        {lookupError && <p className="friends__error">{lookupError}</p>}
                        {lookupResult && (
                            <div className="friends__lookup-result">
                                <span className="friends__lookup-icon">
                                    <GameIcon name={CLASS_ICONS[lookupResult.class] ?? 'bust-in-silhouette'} />
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
                                    <Icon name="plus" /> Dodaj
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
                            const info = infoFor(name);
                            const fav = isFavorite(name);
                            // 2026-05-19 spec ("Jak mam kogoś w liście znajomych
                            // i zablokuje to jest na obu listach naraz"):
                            // friend rows highlight when the same name also
                            // sits on the block list, and the block button
                            // flips to :unlocked: Odblokuj for one-tap recovery.
                            const blockedToo = isBlocked(name);
                            return (
                                <div
                                    key={name}
                                    className={`friends__row${blockedToo ? ' friends__row--also-blocked' : ''}`}
                                >
                                    <button
                                        type="button"
                                        className={`friends__row-star${fav ? ' friends__row-star--on' : ''}`}
                                        onClick={() => toggleFavorite(name)}
                                        title={fav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
                                    >
                                        <GameIcon name="star" />
                                    </button>
                                    <span className="friends__row-icon">
                                        {info ? <GameIcon name={CLASS_ICONS[info.class] ?? 'bust-in-silhouette'} /> : <GameIcon name="bust-in-silhouette" />}
                                    </span>
                                    <div className="friends__row-info">
                                        <div className="friends__row-name">
                                            {name}
                                            {blockedToo && (
                                                <span
                                                    className="friends__row-badge"
                                                    title="Zablokowany — nie otrzymujesz od niego wiadomości"
                                                >
                                                    <GameIcon name="prohibited" />
                                                </span>
                                            )}
                                        </div>
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
                                            <GameIcon name="love-letter" />
                                        </button>
                                        {blockedToo ? (
                                            <button
                                                type="button"
                                                className="friends__action friends__action--unblock"
                                                onClick={() => setConfirm({ kind: 'unblock', name })}
                                                title="Odblokuj gracza"
                                            >
                                                <GameIcon name="unlocked" />
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="friends__action friends__action--block"
                                                onClick={() => setConfirm({ kind: 'block', name })}
                                                title="Zablokuj gracza"
                                            >
                                                <GameIcon name="prohibited" />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            className="friends__action friends__action--remove"
                                            onClick={() => setConfirm({ kind: 'remove', name })}
                                            title="Usuń znajomego"
                                        >
                                            <Icon name="x" />
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
                    {visibleBlocked.length === 0 && (
                        <div className="friends__empty-list">
                            <div className="friends__empty-list-title">Lista jest pusta</div>
                            <div className="friends__empty-list-hint">
                                Zablokowani gracze nie pojawiają się w czacie miasta.
                            </div>
                        </div>
                    )}
                    {visibleBlocked.map((name) => {
                        const alsoFriend = isFriend(name);
                        return (
                            <div key={name} className="friends__row friends__row--blocked">
                                <span className="friends__row-icon"><GameIcon name="prohibited" /></span>
                                <div className="friends__row-info">
                                    <div className="friends__row-name">
                                        {name}
                                        {alsoFriend && (
                                            <span
                                                className="friends__row-badge friends__row-badge--friend"
                                                title="Dalej na Twojej liście znajomych"
                                            >
                                                <GameIcon name="star" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="friends__row-meta">
                                        {alsoFriend
                                            ? 'Znajomy — wiadomości od niego są ukryte, możesz dalej do niego pisać'
                                            : 'Wiadomości ukryte'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className="friends__action friends__action--unblock"
                                    onClick={() => setConfirm({ kind: 'unblock', name })}
                                >
                                    <GameIcon name="unlocked" /> Odblokuj
                                </button>
                            </div>
                        );
                    })}
                </section>
            )}

            {/* 2026-05-19 spec ("dodatkowy popup czy chcemy na pewno
                to zrobić"): one shared confirm dialog for remove /
                block / unblock. Backdrop click + Anuluj button both
                dismiss without acting; only the primary CTA fires
                the underlying mutation. */}
            {confirmCopy && (
                <div
                    className="friends__confirm-backdrop"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setConfirm(null)}
                >
                    <div
                        className="friends__confirm-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="friends__confirm-title">{confirmCopy.title}</h3>
                        <p className="friends__confirm-body">{confirmCopy.body}</p>
                        <div className="friends__confirm-actions">
                            <button
                                type="button"
                                className="friends__confirm-btn"
                                onClick={() => setConfirm(null)}
                            >
                                Anuluj
                            </button>
                            <button
                                type="button"
                                className={`friends__confirm-btn ${confirmCopy.ctaClass}`}
                                onClick={confirmCopy.onConfirm}
                            >
                                {confirmCopy.cta}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Friends;
