import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useArenaStore } from '../../stores/arenaStore';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { useTransformStore } from '../../stores/transformStore';
import { getCharacterAvatar } from '../../data/classAvatars';
import { STONE_ICONS } from '../../systems/itemSystem';
import { getPotionImage } from '../../systems/spriteAssets';
import TinyIcon from '../../components/ui/TinyIcon/TinyIcon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { characterApi } from '../../api/v1/characterApi';
import { supabase } from '../../lib/supabase';
import {
    ARENA_LEAGUE_LABELS,
    ARENA_LEAGUE_COLORS,
    ARENA_LEAGUE_ICONS,
} from '../../types/arena';
import {
    LEAGUE_BOUNDARIES,
    formatSeasonRemaining,
    getAttackableIndices,
    getRewardBuckets,
    applyLeagueMultiplier,
    getSeasonMsRemaining,
    rankCompetitors,
} from '../../systems/arenaSystem';
import { formatGoldShort } from '../../systems/goldFormat';
import Spinner from '../../components/ui/Spinner/Spinner';
import './Arena.scss';

const Arena = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const arenaPoints = useInventoryStore((s) => s.arenaPoints ?? 0);
    const {
        currentArena,
        defenseSnapshot,
        matchLog,
        pendingRewards,
        refreshIfNeeded,
        attemptsRemaining,
        submitDefenseSnapshot,
        finalizeMatch,
        claimSeasonRewards,
        injectOtherPlayers,
    } = useArenaStore();

    // Keep season + arena fresh on mount + when level changes.
    useEffect(() => {
        if (character) refreshIfNeeded(character.level);
    }, [character, refreshIfNeeded]);

    // Pull the user's other characters (Supabase) and slot them into the
    // current arena instance, replacing the same number of low-LP bots.
    // Per spec each character on the account is auto-enrolled in their
    // league every week; this is the closest sync-friendly approximation
    // — the alts join "their" league which for a fresh week is wherever
    // the active character lands. Failure (offline / no session) silently
    // falls back to the bot-only roster.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const { data: session } = await supabase.auth.getSession();
                if (!session.session) return;
                const all = await characterApi.getCharacters(session.session.user.id);
                if (cancelled || !all) return;
                injectOtherPlayers(all.map((c) => ({
                    id: c.id,
                    name: c.name,
                    class: c.class,
                    level: c.level,
                    max_hp: c.max_hp,
                    max_mp: c.max_mp,
                    attack: c.attack,
                    defense: c.defense,
                })));
            } catch {
                // offline / no session — leave the bot roster in place.
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [injectOtherPlayers, currentArena?.id]);

    // Auto-submit the defense snapshot on every visit. Per spec the player
    // is auto-enrolled in their league every week — there is no opt-in
    // button anymore. Re-snapshotting on each visit also keeps the
    // defender stats current with the player's latest gear / level / buffs
    // without surfacing a "press to confirm" UX wart.
    useEffect(() => {
        if (character) submitDefenseSnapshot();
    }, [character, submitDefenseSnapshot]);

    // Centre the leaderboard scroll on the player's own row. We deliberately
    // walk up to the `.arena__list` ancestor and set its scrollTop directly
    // rather than calling `scrollIntoView` — the latter cascades up to the
    // page and would also push the AppShell scroll position, hiding the
    // league strip and the defense card. Local scroll only keeps the
    // chrome visible while the player lands centred on themselves.
    useEffect(() => {
        if (!currentArena) return;
        const raf = requestAnimationFrame(() => {
            const row = meRowRef.current;
            if (!row) return;
            // Walk up to the scroll container (.arena__list).
            let list: HTMLElement | null = row.parentElement;
            while (list && !list.classList.contains('arena__list')) {
                list = list.parentElement;
            }
            if (!list) return;
            // getBoundingClientRect handles arbitrary nesting (the row sits
            // inside a wrapper div for the dividers + row), so compute the
            // delta in viewport space and translate into list-scroll space.
            const rowRect = row.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            const offsetWithinList = rowRect.top - listRect.top + list.scrollTop;
            const target = offsetWithinList - (list.clientHeight / 2) + (rowRect.height / 2);
            list.scrollTop = Math.max(0, target);
        });
        return () => cancelAnimationFrame(raf);
    }, [currentArena]);

    // Re-render every minute so the season countdown ticks live.
    const [, setTickKey] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTickKey((k) => k + 1), 60_000);
        return () => clearInterval(id);
    }, []);

    const [rewardsOpen, setRewardsOpen] = useState(false);
    const [logOpen, setLogOpen] = useState(false);
    // "Walcz" popup — opens from the defense card and shows just the
    // attackable opponents (±2 ranks), so the player can fight without
    // scrolling through the leaderboard to find someone in range.
    const [fightOpen, setFightOpen] = useState(false);
    // Entry transition — fade-to-black before pushing the match route.
    // Click anywhere on the overlay to skip and route immediately.
    const [entering, setEntering] = useState<{ pendingNav: () => void } | null>(null);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    // Auto-scroll target: the player's own leaderboard row. We attach this
    // ref to the `--me` row inside the list and call scrollIntoView in
    // an effect so the user lands centred on themselves rather than at
    // rank #1 every time they open the arena.
    const meRowRef = useRef<HTMLDivElement | null>(null);

    if (!character) {
        return <div className="arena"><Spinner size="lg" /></div>;
    }
    if (!currentArena) {
        return <div className="arena"><Spinner size="lg" label="Inicjalizuję arenę…" /></div>;
    }

    const myCompetitorId = `player_${character.id ?? 'me'}`;
    const ranked = rankCompetitors(currentArena.competitors);
    const myEntry = ranked.find((r) => r.competitor.id === myCompetitorId);
    const attackableOrigIdx = getAttackableIndices(currentArena.competitors, myCompetitorId);
    const attackableIds = new Set(attackableOrigIdx.map((i) => currentArena.competitors[i].id));

    const league = currentArena.league;
    const leagueColor = ARENA_LEAGUE_COLORS[league];
    const leagueIcon = ARENA_LEAGUE_ICONS[league];
    const leagueLabel = ARENA_LEAGUE_LABELS[league];

    const boundary = LEAGUE_BOUNDARIES[league];
    const promoteCutoff = boundary.promotedTop ?? null;
    const relegateStartRank = boundary.relegatedBottom !== null ? 100 - boundary.relegatedBottom + 1 : null;

    const handleAttack = (opponentIdx: number) => {
        const opponent = currentArena.competitors[opponentIdx];
        if (!opponent) return;
        const arena = useArenaStore.getState();
        if (!arena.consumeAttempt()) {
            alert('Brak ataków na dziś (limit 10).');
            return;
        }
        // Determine attacker-is-higher: lower visible rank = better position.
        const myRank = myEntry?.rank ?? 999;
        const oppRank = ranked.find((r) => r.competitor.id === opponent.id)?.rank ?? 999;
        const attackerIsHigher = myRank > oppRank; // attacking UP the table

        // Hand off to the dedicated combat view (route below).
        // We pass IDs via sessionStorage to avoid a chunky URL state.
        sessionStorage.setItem('arena.match', JSON.stringify({
            arenaId: currentArena.id,
            myCompetitorId,
            opponentId: opponent.id,
            attackerIsHigher,
            opponentName: opponent.name,
            opponentClass: opponent.class,
            opponentLevel: opponent.level,
        }));
        // Cinematic entry — overlay fades to black over 1.5s, then we
        // push the route. The match view starts with its own fade-in
        // from black so the transition is seamless.
        const pendingNav = () => navigate('/arena/match');
        setEntering({ pendingNav });
        window.setTimeout(() => {
            // Guard against the user clicking-through (skip) — `entering`
            // gets cleared by the click handler before the timeout fires.
            setEntering((cur) => {
                if (cur) cur.pendingNav();
                return null;
            });
        }, 1500);
        // `finalizeMatch` is called from inside the match view on result —
        // we just declare a use here so the destructured action isn't
        // flagged as unused on this view.
        void finalizeMatch;
    };

    const onClaimRewards = () => {
        const claimed = claimSeasonRewards();
        if (claimed) {
            alert(`Odebrano nagrody za sezon: ${ARENA_LEAGUE_LABELS[claimed.league]}, miejsce ${claimed.finalRank}`);
        }
    };

    const seasonMs = getSeasonMsRemaining();
    const isMonday = new Date().getUTCDay() === 1;

    // The arena id is shaped like `bronze_578656609`. Strip the prefix for
    // the numeric "Liga nr" display so the player sees a clean number; keep
    // the full id for the leading line so the underscore form is also visible.
    const arenaIdNumeric = currentArena.id.split('_').slice(1).join('_') || currentArena.id;

    return (
        <div className="arena">
            {/* League strip — header bar (back + title + global AP) was removed
                per design: AP now lives inline next to the league label, and
                the arena id is shown in two forms inside this strip. */}
            <div
                className="arena__league-strip arena__league-strip--with-color"
                style={{ '--league-color': leagueColor } as React.CSSProperties}
            >
                <div className="arena__league-row">
                    <span className="arena__league-icon"><GameIcon name={leagueIcon} /></span>
                    <span className="arena__league-name">Liga {leagueLabel}</span>
                    <span className="arena__league-ap"><GameIcon name="sports-medal" /> {arenaPoints.toLocaleString('pl-PL')} AP</span>
                </div>
                <div className="arena__league-meta-block">
                    <div className="arena__league-meta arena__league-meta--num">Liga nr: {arenaIdNumeric}</div>
                </div>
                <div className="arena__league-countdown">
                    <GameIcon name="hourglass-not-done" /> Sezon kończy się za: {formatSeasonRemaining(seasonMs)}
                </div>
                <div className="arena__league-actions">
                    <button className="arena__action-chip" onClick={() => setRewardsOpen(true)}><GameIcon name="wrapped-gift" /> Nagrody</button>
                    <button className="arena__action-chip" onClick={() => setLogOpen(true)}>
                        <GameIcon name="scroll" /> Historia ({matchLog.length})
                    </button>
                    {pendingRewards && isMonday && (
                        <button
                            className="arena__action-chip arena__action-chip--claim"
                            onClick={onClaimRewards}
                        >
                            <GameIcon name="trophy" /> Odbierz nagrody (poprzedni sezon)
                        </button>
                    )}
                </div>
            </div>

            {/* Defense snapshot — auto-refreshed; avatar reflects the
                player's highest unlocked transform tier instead of the raw
                class portrait. Title text removed per design; the right
                column is now the "Walcz" CTA that opens an attackable-list
                popup so the player can pick a fight without scrolling to
                find someone in their ±2 rank window. */}
            <div className="arena__defense">
                <div className="arena__defense-avatar">
                    <img
                        src={getCharacterAvatar(character.class, completedTransforms)}
                        alt={character.name}
                    />
                </div>
                <div className="arena__defense-info">
                    <span className="arena__defense-stats">
                        {defenseSnapshot
                            ? `HP ${defenseSnapshot.maxHp.toLocaleString('pl-PL')} · MP ${defenseSnapshot.maxMp.toLocaleString('pl-PL')} · ATK ${defenseSnapshot.attack} · DEF ${defenseSnapshot.defense}`
                            : 'Snapshot zapisuje się automatycznie po wejściu na arenę.'}
                    </span>
                </div>
                <button
                    type="button"
                    className="arena__defense-fight"
                    onClick={() => setFightOpen(true)}
                    disabled={attemptsRemaining() <= 0}
                    title={attemptsRemaining() > 0 ? 'Wybierz przeciwnika' : 'Brak ataków na dziś'}
                >
                    <GameIcon name="crossed-swords" /> Walcz
                </button>
            </div>

            {/* My position summary */}
            {myEntry && (
                <div className="arena__pos-strip">
                    <span className="arena__pos-rank">#{myEntry.rank}</span>
                    <span className="arena__pos-meta">
                        {myEntry.competitor.leaguePoints} LP · {myEntry.competitor.seasonArenaPoints.toLocaleString('pl-PL')} AP w sezonie
                    </span>
                    <span className="arena__pos-attempts">
                        Ataki dziś: {10 - attemptsRemaining()}/10
                    </span>
                </div>
            )}

            {/* Leaderboard. Both dividers render exactly ONCE even when a
                tie produces multiple rows at the cutoff rank. We mark the
                first row at/after the cutoff with the flag and clear it
                so the next row inherits a regular layout. Without these
                guards a 5-way tie at rank 41 would show 5 stacked
                "Awans do wyższej ligi" bars (the bug from issue #3). */}
            <div className="arena__list">
                {(() => {
                    let promoRendered = false;
                    let relegRendered = false;
                    return ranked.map((entry, idx) => {
                        const c = entry.competitor;
                        const isMe = c.id === myCompetitorId;
                        const attackable = !isMe && attackableIds.has(c.id) && attemptsRemaining() > 0;
                        const dividers: React.ReactNode[] = [];
                        // Promotion divider — render BEFORE the first row whose
                        // rank is just past the promotion cutoff. So the line
                        // sits visually beneath the last promoted person (the
                        // tied group above) and above the first row that
                        // missed the cut.
                        if (!promoRendered && promoteCutoff !== null && entry.rank > promoteCutoff) {
                            dividers.push(
                                <div key={`promo-${idx}`} className="arena__divider arena__divider--promo">
                                    <GameIcon name="up-arrow" /> Awans do wyższej ligi
                                </div>,
                            );
                            promoRendered = true;
                        }
                        // Relegation divider — render ONCE before the first
                        // relegated row.
                        if (!relegRendered && relegateStartRank !== null && entry.rank >= relegateStartRank) {
                            dividers.push(
                                <div key={`relegate-${idx}`} className="arena__divider arena__divider--relegate">
                                    <GameIcon name="down-arrow" /> Spadek do niższej ligi
                                </div>,
                            );
                            relegRendered = true;
                        }
                    return (
                        <div key={c.id}>
                            {dividers}
                            <div
                                ref={isMe ? meRowRef : undefined}
                                className={[
                                    'arena__row',
                                    isMe ? 'arena__row--me' : '',
                                    c.isBot ? 'arena__row--bot' : '',
                                    attackable ? 'arena__row--attackable' : '',
                                ].filter(Boolean).join(' ')}
                            >
                                {/* Top-3 wear a medal in front of the rank
                                    chip. Lower ranks just show the number. */}
                                <span className="arena__row-rank">
                                    {entry.rank === 1 && <span className="arena__row-medal"><GameIcon name="1st-place-medal" /></span>}
                                    {entry.rank === 2 && <span className="arena__row-medal"><GameIcon name="2nd-place-medal" /></span>}
                                    {entry.rank === 3 && <span className="arena__row-medal"><GameIcon name="3rd-place-medal" /></span>}
                                    #{entry.rank}
                                </span>
                                <span className="arena__row-avatar">
                                    <img src={getCharacterAvatar(c.class, c.completedTransforms ?? [])} alt={c.name} />
                                </span>
                                <div className="arena__row-info">
                                    <span className="arena__row-name">
                                        {c.name}
                                        {c.isBot && <span className="arena__row-tag" style={{ marginLeft: 6 }}>BOT</span>}
                                    </span>
                                    <span className="arena__row-meta">
                                        {c.class} · Lvl {c.level}
                                    </span>
                                </div>
                                <span className="arena__row-points">{c.leaguePoints} LP</span>
                                {attackable ? (
                                    <button
                                        className="arena__row-attack"
                                        onClick={() => handleAttack(currentArena.competitors.indexOf(c))}
                                    >
                                        <GameIcon name="crossed-swords" /> Atak
                                    </button>
                                ) : (
                                    <span style={{ width: 60 }} aria-hidden="true" />
                                )}
                            </div>
                        </div>
                    );
                });
                })()}
            </div>

            {/* Rewards popup */}
            {rewardsOpen && (
                <div className="arena__modal-bg" onClick={() => setRewardsOpen(false)}>
                    <div className="arena__modal" onClick={(e) => e.stopPropagation()}>
                        <div className="arena__modal-head">
                            <span className="arena__modal-title"><GameIcon name="wrapped-gift" /> Nagrody — {leagueLabel}</span>
                            <button className="arena__modal-close" onClick={() => setRewardsOpen(false)}>×</button>
                        </div>
                        {getRewardBuckets().map((b) => {
                            const scaled = applyLeagueMultiplier(b, league);
                            // Medal glyph for the top 3 positions: gold / silver
                            // / bronze. Lower buckets show no medal — the rank
                            // chip alone is enough chrome.
                            const medal = b.positionLabel === '1' ? '1st-place-medal'
                                : b.positionLabel === '2' ? '2nd-place-medal'
                                : b.positionLabel === '3' ? '3rd-place-medal'
                                : null;
                            return (
                                <div key={b.positionLabel} className="arena__reward-row">
                                    <span className="arena__reward-pos">
                                        {medal && <span className="arena__reward-medal"><GameIcon name={medal} /></span>}
                                        #{b.positionLabel}
                                    </span>
                                    <span className="arena__reward-line">
                                        <span className="arena__reward-chip arena__reward-chip--ap">
                                            <GameIcon name="sports-medal" /> {scaled.arenaPoints.toLocaleString('pl-PL')} AP
                                        </span>
                                        <span className="arena__reward-chip arena__reward-chip--gold">
                                            <GameIcon name="money-bag" /> {formatGoldShort(scaled.gold)}
                                        </span>
                                        {scaled.mythicStones > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--mythic">
                                                <TinyIcon icon={STONE_ICONS.mythic_stone ?? 'gem-stone'} size="sm" /> {scaled.mythicStones} mythic
                                            </span>
                                        )}
                                        {scaled.legendaryStones > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--legendary">
                                                <TinyIcon icon={STONE_ICONS.legendary_stone ?? 'gem-stone'} size="sm" /> {scaled.legendaryStones} legendary
                                            </span>
                                        )}
                                        {scaled.epicStones > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--epic">
                                                <TinyIcon icon={STONE_ICONS.epic_stone ?? 'gem-stone'} size="sm" /> {scaled.epicStones} epic
                                            </span>
                                        )}
                                        {scaled.rareStones > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--rare">
                                                <TinyIcon icon={STONE_ICONS.rare_stone ?? 'gem-stone'} size="sm" /> {scaled.rareStones} rare
                                            </span>
                                        )}
                                        {scaled.commonStones > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--common">
                                                <TinyIcon icon={STONE_ICONS.common_stone ?? 'gem-stone'} size="sm" /> {scaled.commonStones} common
                                            </span>
                                        )}
                                        {scaled.pctHpPotion > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--hp">
                                                <TinyIcon icon={getPotionImage('hp_potion_great') ?? 'red-heart'} size="sm" /> ×{scaled.pctHpPotion}
                                            </span>
                                        )}
                                        {scaled.pctMpPotion > 0 && (
                                            <span className="arena__reward-chip arena__reward-chip--mp">
                                                <TinyIcon icon={getPotionImage('mp_potion_great') ?? 'droplet'} size="sm" /> ×{scaled.pctMpPotion}
                                            </span>
                                        )}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Log popup */}
            {logOpen && (
                <div className="arena__modal-bg" onClick={() => setLogOpen(false)}>
                    <div className="arena__modal" onClick={(e) => e.stopPropagation()}>
                        <div className="arena__modal-head">
                            <span className="arena__modal-title"><GameIcon name="scroll" /> Historia walk</span>
                            <button className="arena__modal-close" onClick={() => setLogOpen(false)}>×</button>
                        </div>
                        {matchLog.length === 0 ? (
                            <p style={{ color: '#aaa', fontStyle: 'italic' }}>Brak walk w tym sezonie.</p>
                        ) : matchLog.map((m) => (
                            <div
                                key={m.id}
                                className={`arena__log-row ${m.won ? 'arena__log-row--won' : 'arena__log-row--lost'}`}
                            >
                                <span>{m.won ? <GameIcon name="check-mark-button" /> : <GameIcon name="cross-mark" />}</span>
                                <span>vs {m.opponentName} ({m.opponentClass} L{m.opponentLevel})</span>
                                <span style={{ color: '#ffd54f' }}>+{m.arenaPointsDelta} AP</span>
                                <span style={{ color: '#66bb6a' }}>+{m.leaguePointsDelta} LP</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Entry-to-fight overlay — fades from transparent -> solid
                black over 1.5s, then routes to /arena/match. Click anywhere
                to skip and go immediately. The match view then plays its
                own fade-in from black for a continuous transition. */}
            {entering && (
                <div
                    className="arena__entry-overlay"
                    onClick={() => {
                        setEntering(null);
                        entering.pendingNav();
                    }}
                />
            )}

            {/* "Walcz" opponent picker — opens from the defense card and
                lists every attackable competitor (±2 ranks). Picking one
                fires the same `handleAttack` path as the leaderboard row,
                so the player gets a focused choose-and-fight flow. */}
            {fightOpen && (
                <div className="arena__modal-bg" onClick={() => setFightOpen(false)}>
                    <div className="arena__modal" onClick={(e) => e.stopPropagation()}>
                        <div className="arena__modal-head">
                            <span className="arena__modal-title"><GameIcon name="crossed-swords" /> Wybierz przeciwnika</span>
                            <button className="arena__modal-close" onClick={() => setFightOpen(false)}>×</button>
                        </div>
                        {attackableOrigIdx.length === 0 ? (
                            <p style={{ color: '#aaa', fontStyle: 'italic' }}>
                                Brak przeciwników w zasięgu (±2 miejsca) — sprawdź ranking.
                            </p>
                        ) : attackableOrigIdx.map((oi) => {
                            const c = currentArena.competitors[oi];
                            const entry = ranked.find((r) => r.competitor.id === c.id);
                            return (
                                <div
                                    key={c.id}
                                    className="arena__row arena__row--attackable"
                                    style={{ marginBottom: 6, cursor: 'pointer' }}
                                    onClick={() => {
                                        setFightOpen(false);
                                        handleAttack(oi);
                                    }}
                                >
                                    <span className="arena__row-rank">#{entry?.rank ?? '?'}</span>
                                    <span className="arena__row-avatar">
                                        <img src={getCharacterAvatar(c.class, c.completedTransforms ?? [])} alt={c.name} />
                                    </span>
                                    <div className="arena__row-info">
                                        <span className="arena__row-name">
                                            {c.name}
                                            {c.isBot && <span className="arena__row-tag" style={{ marginLeft: 6 }}>BOT</span>}
                                        </span>
                                        <span className="arena__row-meta">
                                            {c.class} · Lvl {c.level}
                                        </span>
                                    </div>
                                    <span className="arena__row-points">{c.leaguePoints} LP</span>
                                    <span className="arena__row-attack"><GameIcon name="crossed-swords" /> Atak</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Arena;
