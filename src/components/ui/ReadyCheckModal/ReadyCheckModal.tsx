import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCharacterStore } from '../../../stores/characterStore';
import { usePartyStore } from '../../../stores/partyStore';
import { usePartyReadyCheckStore } from '../../../stores/partyReadyCheckStore';
import bossData from '../../../data/bosses.json';
import { getAllRaids } from '../../../systems/raidSystem';
import { getDungeonImage } from '../../../systems/spriteAssets';
import { BossSprite, MonsterSprite } from '../Sprite/MonsterSprite';
import type { IMonster } from '../../../types/monster';
import GameIcon from '../../atoms/Twemoji/GameIcon';
import './ReadyCheckModal.scss';

/**
 * Renders the "Gotowy?" popup whenever a party ready-check is in
 * flight. Mounted globally in AppShell so it sits on top of every
 * screen — a member could be browsing the inventory when the leader
 * fires the check.
 *
 * Behaviour:
 *   - The local player sees a Gotowy / Anuluj button until they click
 *     Gotowy (then their card becomes a green check).
 *   - The leader's modal also auto-fires the `go` broadcast once
 *     everyone is ready, sending all members to the destination route.
 *   - Anyone clicking Anuluj closes the modal for everyone.
 *
 * 2026-05-13 spec ("Na tym popupie pokazuj obrazek potwora na jakiego
 * idziemy jego nazwe oraz poziom, tak samo przed napisz czy to
 * Polowanie czy Boss czy raid czy trainer"): the modal now reads the
 * destination + payload to render a kind label (Polowanie/Boss/Raid/
 * Trainer) plus the target's sprite + name + level. Members get a
 * preview of what they're confirming before they hit Gotowy.
 */

const ReadyCheckModal = () => {
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const open = usePartyReadyCheckStore((s) => s.open);
    const destination = usePartyReadyCheckStore((s) => s.destination);
    const payload = usePartyReadyCheckStore((s) => s.payload);
    const requiredIds = usePartyReadyCheckStore((s) => s.requiredIds);
    const readyIds = usePartyReadyCheckStore((s) => s.readyIds);
    const requesterId = usePartyReadyCheckStore((s) => s.requesterId);
    const ready = usePartyReadyCheckStore((s) => s.ready);
    const cancel = usePartyReadyCheckStore((s) => s.cancel);
    const fireGo = usePartyReadyCheckStore((s) => s.fireGo);

    // Leader-side: when everyone in the required set has confirmed,
    // broadcast `go`. Doing it from a useEffect avoids the race the
    // store's auto-fire path would hit (state not yet settled).
    useEffect(() => {
        if (!open || !character || !requesterId) return;
        if (requesterId !== character.id) return;
        if (requiredIds.length === 0) return;
        const allReady = requiredIds.every((id) => readyIds.includes(id));
        if (allReady) fireGo();
    }, [open, character, requesterId, requiredIds, readyIds, fireGo]);

    // Resolve the target preview from destination + payload. Hunt ships
    // the full IMonster, boss/raid ship just an id (we look up the
    // static def). Trainer doesn't ship any payload — it just shows a
    // generic "Trainer" header. Memoised so a re-ready doesn't recompute
    // the find() on every render.
    const target = useMemo(() => resolveTarget(destination, payload), [destination, payload]);

    if (!open || !character || !party) return null;

    const meReady = readyIds.includes(character.id);

    return (
        <AnimatePresence>
            <motion.div
                className="ready-check__backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                <motion.div
                    className="ready-check__modal"
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.96, opacity: 0 }}
                >
                    <div className="ready-check__title"><GameIcon name="crossed-swords" /> Gotowość do walki</div>
                    <div className="ready-check__kind">{target.kindLabel}</div>
                    {/* 2026-05-14 spec ("Tam powinno byc to zdjecie co
                        jest na danym tle backgroundzie dla tego raidu
                        a nie powinno byc zdjecia potworu, tylko caly
                        ten kafelek jako tlo i napis nazwa i poziom"):
                        raids render as a single tile with the dungeon
                        painting as the background and name+level
                        centred over a dark gradient — no monster
                        portrait. Hunt and boss keep the original
                        sprite + meta side-by-side layout. */}
                    {target.kind === 'raid' && (target.name || target.bgImage) && (
                        <div
                            className="ready-check__target ready-check__target--raid"
                            style={target.bgImage
                                ? { backgroundImage: `url("${target.bgImage}")` }
                                : undefined}
                        >
                            <div className="ready-check__target-overlay">
                                {target.name && (
                                    <div className="ready-check__target-name">{target.name}</div>
                                )}
                                {typeof target.level === 'number' && (
                                    <div className="ready-check__target-level">Lvl {target.level}</div>
                                )}
                            </div>
                        </div>
                    )}
                    {target.kind !== 'trainer' && target.kind !== 'raid' && (target.name || target.sprite) && (
                        <div className="ready-check__target">
                            {target.sprite && (
                                <div className="ready-check__target-sprite">
                                    {target.kind === 'boss' ? (
                                        <BossSprite
                                            level={target.level ?? 1}
                                            sprite={target.sprite}
                                            name={target.name ?? ''}
                                            style={{ objectFit: 'cover' }}
                                        />
                                    ) : (
                                        <MonsterSprite
                                            level={target.level ?? 1}
                                            sprite={target.sprite}
                                            name={target.name ?? ''}
                                            style={{ objectFit: 'cover' }}
                                        />
                                    )}
                                </div>
                            )}
                            <div className="ready-check__target-meta">
                                {target.name && (
                                    <div className="ready-check__target-name">{target.name}</div>
                                )}
                                {typeof target.level === 'number' && (
                                    <div className="ready-check__target-level">Lvl {target.level}</div>
                                )}
                            </div>
                        </div>
                    )}
                    <div className="ready-check__sub">
                        Lider rusza grupę. Każdy musi potwierdzić by ruszyć razem.
                    </div>
                    <ul className="ready-check__list">
                        {party.members.map((m) => {
                            const isReady = readyIds.includes(m.id);
                            const isMe = m.id === character.id;
                            return (
                                <li
                                    key={m.id}
                                    className={`ready-check__row${isReady ? ' ready-check__row--ready' : ''}`}
                                >
                                    <span className="ready-check__dot" aria-hidden>{isReady ? <GameIcon name="check-mark-button" /> : '…'}</span>
                                    <span className="ready-check__name">
                                        {m.name}
                                        {isMe && <span className="ready-check__you"> (Ty)</span>}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="ready-check__actions">
                        <button
                            type="button"
                            className="ready-check__btn ready-check__btn--cancel"
                            onClick={() => cancel(character.id)}
                        >
                            Anuluj
                        </button>
                        <button
                            type="button"
                            className="ready-check__btn ready-check__btn--ready"
                            onClick={() => ready(character.id)}
                            disabled={meReady}
                        >
                            {meReady ? <>Gotowy <GameIcon name="check-mark-button" /></> : 'Gotowy'}
                        </button>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

interface IReadyCheckTarget {
    kind: 'hunt' | 'boss' | 'raid' | 'trainer' | 'unknown';
    kindLabel: string;
    name?: string;
    level?: number;
    /** Sprite path/emoji passed to MonsterSprite / BossSprite. Used for
     *  hunt / boss only — raid uses `bgImage` instead. */
    sprite?: string;
    /** 2026-05-14 spec ("Nie widze na popupie jako sojusznik zdjecia
     *  raidu. Tam powinno byc to zdjecie co jest na danym tle
     *  backgroundzie dla tego raidu a nie powinno byc zdjecia
     *  potworu, tylko caly ten kafelek jako tlo i napis nazwa i
     *  poziom"): raids render as a single tile with the dungeon
     *  painting as the BACKGROUND (no separate monster portrait),
     *  matching how the raid list cards present each raid. */
    bgImage?: string;
}

/** Decode destination + payload into a renderable preview. Defensive —
 *  any malformed payload falls back to the unknown bucket so the popup
 *  still opens (rather than crashing the global modal). */
const resolveTarget = (destination: string | null, payload: unknown): IReadyCheckTarget => {
    if (!destination) {
        return { kind: 'unknown', kindLabel: '?' };
    }
    if (destination === '/combat') {
        const p = payload as { monster?: IMonster } | null;
        const m = p?.monster;
        return {
            kind: 'hunt',
            kindLabel: 'Polowanie',
            name: m?.name_pl,
            level: m?.level,
            sprite: m?.sprite ?? 'ogre',
        };
    }
    if (destination === '/boss') {
        const p = payload as { bossId?: string } | null;
        const boss = p?.bossId
            ? (bossData as Array<{ id: string; name_pl: string; level: number; sprite?: string }>)
                .find((b) => b.id === p.bossId)
            : undefined;
        return {
            kind: 'boss',
            kindLabel: 'Boss',
            name: boss?.name_pl,
            level: boss?.level,
            sprite: boss?.sprite ?? 'ogre',
        };
    }
    if (destination === '/raid') {
        const p = payload as { raidId?: string } | null;
        const raid = p?.raidId
            ? getAllRaids().find((r) => r.id === p.raidId)
            : undefined;
        // 2026-05-14: pull the source-dungeon painting as the tile
        // background — same image the raid list card uses, so the
        // ready-check preview matches what the player just saw on
        // /raid before the leader fired the check.
        const bgUrl = raid?.sourceDungeonId
            ? (getDungeonImage(raid.sourceDungeonId) ?? undefined)
            : undefined;
        return {
            kind: 'raid',
            kindLabel: 'Raid',
            name: raid?.name_pl,
            level: raid?.level,
            bgImage: bgUrl,
        };
    }
    if (destination === '/trainer') {
        return { kind: 'trainer', kindLabel: 'Trainer' };
    }
    return { kind: 'unknown', kindLabel: destination };
};

export default ReadyCheckModal;
