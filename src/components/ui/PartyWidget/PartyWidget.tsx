import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import { usePartyDamageStore } from '../../../stores/partyDamageStore';
import { usePartyPresenceStore } from '../../../stores/partyPresenceStore';
import { useTransformStore } from '../../../stores/transformStore';
import { getCharacterAvatar } from '../../../data/classAvatars';
import { getEffectiveChar } from '../../../systems/combatEngine';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './PartyWidget.scss';

/**
 * Floating party widget — renders a small shield button on every screen
 * when the player is in a party. Tapping it opens a popover listing
 * every ally with their level, HP, MP and damage dealt in the current
 * activity.
 *
 * Hidden while the player isn't in a party AND on characterless routes
 * (login / character-select). HP / MP for the LOCAL player come from
 * the live characterStore so the popover reflects current values
 * instantly. Remote allies show their last known HP/MP (server-synced
 * when the peer-sync layer is wired) — until then those fields display
 * `?` for non-self members.
 */

const CHARACTERLESS_ROUTES = new Set<string>([
    '/login',
    '/register',
    '/forgot-password',
    '/character-select',
    '/create-character',
]);

// 2026-05-19 v14: the legacy combat-route hide list is gone. The
// shield button now lives in the bottom-right corner above the
// chat icon, far from any in-arena ally slot, so it can stay
// visible during combat without overlapping the cards.

const CLASS_ICONS: Record<string, string> = {
    Knight: 'crossed-swords', Mage: 'crystal-ball', Cleric: 'sparkles', Archer: 'bow-and-arrow',
    Rogue: 'dagger', Necromancer: 'skull', Bard: 'musical-note',
};
const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const formatDmg = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return Math.floor(n).toString();
};

const PartyWidget = () => {
    const location = useLocation();
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const damageMap = usePartyDamageStore((s) => s.damage);
    const presenceMap = usePartyPresenceStore((s) => s.byMember);
    // 2026-05-14: subscribe to the local transformStore so the widget
    // re-renders when the player completes a new transform and the
    // self avatar refreshes to the higher-tier sprite.
    const ownCompletedTransforms = useTransformStore((s) => s.completedTransforms);
    const [open, setOpen] = useState(false);
    // 2026-05-19 v3 spec ("z ikonki z party kasujemy guzik do
    // chatowania itp bo przenosimy go do ikonki z chatem"): chat
    // tab moved into the dedicated bottom-left chat icon's popover.
    // The party widget is now purely the live roster + damage
    // tracker — chat reachable via the chat bubble.
    const popoverRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Outside-click + Escape to close.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            const t = e.target as Node | null;
            if (!t) return;
            if (popoverRef.current && popoverRef.current.contains(t)) return;
            if (buttonRef.current && buttonRef.current.contains(t)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Hide only on auth / character-select. 2026-05-19 v14 spec
    // ("Ikonka party ma byc na stale jezeli jestesmy w party"): the
    // widget now stays visible on every in-game route — including
    // combat — once the player has joined a party. It's sized to
    // match the chat icon and stacks above it in the bottom-right,
    // so it no longer overlaps the in-arena ally slots.
    const norm = location.pathname.replace(/\/+$/, '');
    if (CHARACTERLESS_ROUTES.has(norm) || CHARACTERLESS_ROUTES.has(location.pathname)) return null;
    if (!character || !party) return null;

    const totalDmg = Object.values(damageMap).reduce((a, b) => a + b, 0);

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                className={`party-widget__btn${open ? ' party-widget__btn--active' : ''}`}
                aria-label="Party"
                title="Party"
                onClick={() => setOpen((v) => !v)}
            >
                <span className="party-widget__btn-icon" aria-hidden="true"><GameIcon name="shield" /></span>
                <span className="party-widget__btn-count">{party.members.length}</span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        ref={popoverRef}
                        className="party-widget__popover"
                        initial={{ opacity: 0, y: -8, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.97 }}
                        transition={{ duration: 0.16 }}
                    >
                        <div className="party-widget__title">
                            <span>{party.name ?? 'Party'}</span>
                            <span className="party-widget__title-dmg">
                                Σ {formatDmg(totalDmg)} dmg
                            </span>
                        </div>
                        <ul className="party-widget__list">
                            {party.members.map((m) => {
                                const isMe = m.id === character.id;
                                const cClass = m.class;
                                const accent = CLASS_COLORS[cClass] ?? '#9e9e9e';
                                // 2026-05-09: ally avatar uses the live
                                // realtime presence snapshot so the right
                                // transformed avatar PNG renders for every
                                // member. Falls back to base class avatar
                                // when no snapshot has arrived yet.
                                const presence = presenceMap[m.id];
                                const tierForAvatar = isMe
                                    ? undefined // self uses local transformStore via getCharacterAvatar([])
                                    : (presence?.transformTier ?? 0);
                                // 2026-05-14 spec ("Ikonka sojusznikow ma
                                // bledny avatar nie jest z transformu tam
                                // gdzie sie sumuje dmg"): self avatar
                                // pulls completedTransforms from the
                                // local transformStore so the widget
                                // shows the player's ACTUAL transformed
                                // avatar (matches the in-game card).
                                // Allies still come from the realtime
                                // presence tier as before.
                                const avatarSrc = isMe
                                    ? getCharacterAvatar(character.class, ownCompletedTransforms)
                                    : getCharacterAvatar(cClass, tierForAvatar ? [tierForAvatar] : []);

                                // Live HP/MP — local player uses EFFECTIVE
                                // max (base + equip + training + elixirs +
                                // transform) so the bar matches the header.
                                // Allies read off the realtime presence
                                // broadcast which already publishes
                                // effective max via usePartyPresence.
                                const eff = isMe ? getEffectiveChar(character) : null;
                                const hp = isMe
                                    ? Math.min(character.hp, eff?.max_hp ?? character.max_hp)
                                    : (presence?.hp ?? null);
                                const maxHp = isMe
                                    ? (eff?.max_hp ?? character.max_hp)
                                    : (presence?.maxHp ?? null);
                                const mp = isMe
                                    ? Math.min(character.mp, eff?.max_mp ?? character.max_mp)
                                    : (presence?.mp ?? null);
                                const maxMp = isMe
                                    ? (eff?.max_mp ?? character.max_mp)
                                    : (presence?.maxMp ?? null);
                                const hasHp = hp !== null && maxHp !== null && maxHp > 0;
                                const hasMp = mp !== null && maxMp !== null && maxMp > 0;
                                const hpPct = hasHp ? Math.max(0, Math.min(1, (hp as number) / (maxHp as number))) : 0;
                                const mpPct = hasMp ? Math.max(0, Math.min(1, (mp as number) / (maxMp as number))) : 0;

                                const dmg = damageMap[m.id] ?? 0;

                                return (
                                    <li
                                        key={m.id}
                                        className="party-widget__row"
                                        style={{ '--ally-color': accent } as React.CSSProperties}
                                    >
                                        <div className="party-widget__row-avatar">
                                            {avatarSrc
                                                ? <img src={avatarSrc} alt={m.name} />
                                                : <span><GameIcon name={CLASS_ICONS[cClass] ?? '?'} /></span>}
                                        </div>
                                        <div className="party-widget__row-main">
                                            <div className="party-widget__row-name">
                                                {m.name}
                                                <span className="party-widget__row-lvl">Lv {m.level}</span>
                                            </div>
                                            <div className="party-widget__row-bars">
                                                <div className="party-widget__bar party-widget__bar--hp">
                                                    <div className="party-widget__bar-fill" style={{ width: `${hpPct * 100}%` }} />
                                                    <span className="party-widget__bar-label">
                                                        {hasHp ? `${hp}/${maxHp}` : '?'}
                                                    </span>
                                                </div>
                                                <div className="party-widget__bar party-widget__bar--mp">
                                                    <div className="party-widget__bar-fill" style={{ width: `${mpPct * 100}%` }} />
                                                    <span className="party-widget__bar-label">
                                                        {hasMp ? `${mp}/${maxMp}` : '?'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="party-widget__row-dmg" title="Obrażenia w bieżącej walce">
                                            {formatDmg(dmg)}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};

export default PartyWidget;
