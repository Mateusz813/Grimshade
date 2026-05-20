import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useCharacterStore } from '../stores/characterStore';
import { usePartyStore } from '../stores/partyStore';
import { useTransformStore } from '../stores/transformStore';
import { useMasteryStore } from '../stores/masteryStore';
import { useCombatStore } from '../stores/combatStore';
import { useSettingsStore } from '../stores/settingsStore';
import { usePartyPresenceStore, type IPartyMemberSnapshot } from '../stores/partyPresenceStore';
import { useNecroSummonStore } from '../stores/necroSummonStore';
import { getEffectiveChar } from '../systems/combatEngine';
import { getMonsterUnlockStatus } from '../systems/progression';
import monstersData from '../data/monsters.json';
import type { IMonster } from '../types/monster';

/**
 * Mounted once at the top of the app shell. While the player is in a
 * party, this hook:
 *   1. Subscribes to the party's broadcast channel so we receive other
 *      members' HP/MP/transform snapshots.
 *   2. Publishes our own snapshot every 2 s (and once on every HP/MP
 *      change, throttled by the store's internal 500 ms gate).
 *
 * When the player leaves the party (or logs out), the subscription is
 * torn down and snapshots are cleared.
 */

const PUBLISH_INTERVAL_MS = 2_000;

const ALL_MONSTERS_SORTED: IMonster[] = (monstersData as unknown as IMonster[])
    .slice()
    .sort((a, b) => a.level - b.level);

/**
 * Find the highest monster level the local player has unlocked
 * (level gate passes + mastery gate passes on previous monster).
 * Returns the level of that monster; 0 if nothing is unlocked yet.
 *
 * Used by `usePartyPresence` to broadcast the cap, so the leader's
 * monster picker can filter by `min(party members' value)` and only
 * offer fights every member can actually start.
 */
const computeMaxUnlockedMonsterLevel = (
    characterLevel: number,
): number => {
    const masteries = useMasteryStore.getState().masteries;
    let maxLvl = 0;
    for (const m of ALL_MONSTERS_SORTED) {
        const unlock = getMonsterUnlockStatus(m, ALL_MONSTERS_SORTED, characterLevel, masteries);
        if (!unlock.unlocked) break;
        if (m.level > maxLvl) maxLvl = m.level;
    }
    return maxLvl;
};

export const usePartyPresence = (): void => {
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const subscribe = usePartyPresenceStore((s) => s.subscribe);
    const publish = usePartyPresenceStore((s) => s.publish);
    const clear = usePartyPresenceStore((s) => s.clear);
    // 2026-05-15 v4: ship the local router pathname in every snapshot
    // so combat views (Trainer in particular) can filter the ally
    // roster — a member who navigates AWAY from /trainer should
    // disappear from the others' trainer card grid.
    const location = useLocation();
    const currentRoute = location.pathname;

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        // Drop everything when there's no party context — keeps a tab
        // that just left a party from leaking the channel.
        if (!party?.id || !character) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            clear();
            return;
        }

        const cleanup = subscribe(party.id);

        // Publish helper that pulls the freshest values from the
        // characterStore + transformStore — those are zustand stores
        // so reading state at call time is cheap and always current.
        const sendNow = () => {
            const c = useCharacterStore.getState().character;
            if (!c) return;
            const tier = computeHighestTransformTier(useTransformStore.getState().completedTransforms);
            // 2026-05-09 spec ("Bledne wartosci HP i MP"): the header
            // bars use effective max (base + equipment + training +
            // elixirs + transform). Broadcast that same effective max
            // so other allies see matching percentages — otherwise the
            // PartyWidget bar would clip at 100% of the BASE max while
            // the player's actual HP cap can be 2-3x higher.
            const eff = getEffectiveChar(c);
            const effMaxHp = eff?.max_hp ?? c.max_hp;
            const effMaxMp = eff?.max_mp ?? c.max_mp;
            // 2026-05-12 spec ("knight ma wiecej many niz faktycznie ma"):
            // during an ACTIVE fight the truth is in `combatStore.playerCurrentHp/Mp`,
            // not `character.hp/mp`. Spells drain combatStore's MP via
            // `spendPlayerMp`; the character's MP only updates between
            // fights via the sync useEffect (and that sync is skipped
            // for non-leader members, so it lags badly). Read live
            // combat HP/MP first, fall back to character when idle.
            const cs = useCombatStore.getState();
            const inFight = cs.phase === 'fighting' || cs.phase === 'victory';
            const liveHp = inFight ? cs.playerCurrentHp : c.hp;
            const liveMp = inFight ? cs.playerCurrentMp : c.mp;
            // 2026-05-15 v16: include our live summon list when we
            // are a Necromancer so every other client renders the
            // front-summon avatar + per-type badge counts on our
            // ally card. Non-necros publish undefined (zero-cost
            // payload). Keep only the per-summon fields the renderer
            // needs (type + HP/MP for the avatar swap bars) to keep
            // the broadcast payload compact.
            const summonsLocal = c.class === 'Necromancer'
                ? (useNecroSummonStore.getState().summons[c.id] ?? []).map((s) => ({
                    type: s.type, hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp,
                }))
                : undefined;
            publish({
                id: c.id,
                hp: Math.min(liveHp, effMaxHp),
                maxHp: effMaxHp,
                mp: Math.min(liveMp, effMaxMp),
                maxMp: effMaxMp,
                transformTier: tier,
                maxUnlockedMonsterLevel: computeMaxUnlockedMonsterLevel(c.level),
                // 2026-05-14 spec ("w party kazdy sojusznik moze sam
                // decydowac czy uzywa auto spelli"): broadcast our
                // local skillMode so the leader's combat engine knows
                // whether to auto-cast spells for our character.
                skillMode: useSettingsStore.getState().skillMode,
                // 2026-05-15 v4: ship the pathname so trainer's ally
                // roster filter knows whether THIS member is still
                // in the trainer view.
                currentRoute: window.location.pathname,
                summons: summonsLocal,
            });
        };

        // Send once immediately so other members see us right away,
        // then every PUBLISH_INTERVAL_MS for steady-state updates.
        sendNow();
        intervalRef.current = setInterval(sendNow, PUBLISH_INTERVAL_MS);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            cleanup();
        };
    // We only restart the heartbeat when party id or character id flips —
    // HP/MP changes on the same character don't need to re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [party?.id, character?.id]);

    // 2026-05-15 v17 spec ("Necromanta przywolal 2 summony i jako
    // sojusznik caly czas mi przeskakuje zdjecie summonu i necromanty
    // na zmiane"): every publish path MUST include the live summons
    // list. Previously only the heartbeat sendNow() included them —
    // every HP/MP-change publish (which fires constantly during
    // combat) overwrote the receiver's snapshot with summons=undefined,
    // and the necro's card flipped back to the base avatar until the
    // next 2 s heartbeat re-populated. Helper centralises the summons
    // pull so every site stays in sync.
    const buildSnapshotSummons = (ch: { id: string; class: string } | null): IPartyMemberSnapshot['summons'] => {
        if (!ch || ch.class !== 'Necromancer') return undefined;
        return (useNecroSummonStore.getState().summons[ch.id] ?? []).map((s) => ({
            type: s.type, hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp,
        }));
    };

    // ALSO publish on each HP/MP/transform change so an ally's bars
    // tick down in real-time during combat without waiting for the
    // next 2 s heartbeat. The presence store throttles internally so
    // we won't flood the channel on every HP delta.
    useEffect(() => {
        if (!party?.id || !character) return;
        const tier = computeHighestTransformTier(completedTransforms);
        const eff = getEffectiveChar(character);
        const effMaxHp = eff?.max_hp ?? character.max_hp;
        const effMaxMp = eff?.max_mp ?? character.max_mp;
        // Same live-MP source as sendNow above — see comment there.
        const cs = useCombatStore.getState();
        const inFight = cs.phase === 'fighting' || cs.phase === 'victory';
        const liveHp = inFight ? cs.playerCurrentHp : character.hp;
        const liveMp = inFight ? cs.playerCurrentMp : character.mp;
        publish({
            id: character.id,
            hp: Math.min(liveHp, effMaxHp),
            maxHp: effMaxHp,
            mp: Math.min(liveMp, effMaxMp),
            maxMp: effMaxMp,
            transformTier: tier,
            maxUnlockedMonsterLevel: computeMaxUnlockedMonsterLevel(character.level),
            // 2026-05-14: see sendNow comment.
            skillMode: useSettingsStore.getState().skillMode,
            currentRoute,
            summons: buildSnapshotSummons(character),
        });
    }, [
        party?.id,
        character?.id,
        character?.hp,
        character?.max_hp,
        character?.mp,
        character?.max_mp,
        completedTransforms,
        currentRoute,
        publish,
        character,
    ]);

    // 2026-05-14: republish whenever the player toggles auto/manual
    // skills locally so the leader's engine picks up the change within
    // one re-render rather than waiting for the next 2 s heartbeat.
    const skillMode = useSettingsStore((s) => s.skillMode);
    useEffect(() => {
        if (!party?.id || !character) return;
        const tier = computeHighestTransformTier(completedTransforms);
        const eff = getEffectiveChar(character);
        const effMaxHp = eff?.max_hp ?? character.max_hp;
        const effMaxMp = eff?.max_mp ?? character.max_mp;
        const cs = useCombatStore.getState();
        const inFight = cs.phase === 'fighting' || cs.phase === 'victory';
        const liveHp = inFight ? cs.playerCurrentHp : character.hp;
        const liveMp = inFight ? cs.playerCurrentMp : character.mp;
        publish({
            id: character.id,
            hp: Math.min(liveHp, effMaxHp),
            maxHp: effMaxHp,
            mp: Math.min(liveMp, effMaxMp),
            maxMp: effMaxMp,
            transformTier: tier,
            maxUnlockedMonsterLevel: computeMaxUnlockedMonsterLevel(character.level),
            skillMode,
            currentRoute,
            summons: buildSnapshotSummons(character),
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skillMode, party?.id, character?.id, currentRoute]);

    // 2026-05-12: in-fight HP/MP changes (via combatStore.playerCurrentHp/Mp)
    // also need to trigger an immediate broadcast. The `character.*` deps
    // above don't fire when only combatStore changes — and for members
    // that's where ALL the MP drain lives. Subscribe to the store
    // directly and re-publish on every change.
    useEffect(() => {
        if (!party?.id || !character) return;
        const unsub = useCombatStore.subscribe((s, prev) => {
            if (s.playerCurrentHp === prev.playerCurrentHp &&
                s.playerCurrentMp === prev.playerCurrentMp) return;
            const ch = useCharacterStore.getState().character;
            if (!ch) return;
            const eff = getEffectiveChar(ch);
            const effMaxHp = eff?.max_hp ?? ch.max_hp;
            const effMaxMp = eff?.max_mp ?? ch.max_mp;
            const tier = computeHighestTransformTier(useTransformStore.getState().completedTransforms);
            const inFight = s.phase === 'fighting' || s.phase === 'victory';
            const liveHp = inFight ? s.playerCurrentHp : ch.hp;
            const liveMp = inFight ? s.playerCurrentMp : ch.mp;
            publish({
                id: ch.id,
                hp: Math.min(liveHp, effMaxHp),
                maxHp: effMaxHp,
                mp: Math.min(liveMp, effMaxMp),
                maxMp: effMaxMp,
                transformTier: tier,
                maxUnlockedMonsterLevel: computeMaxUnlockedMonsterLevel(ch.level),
                currentRoute: window.location.pathname,
                summons: buildSnapshotSummons(ch),
            });
        });
        return () => { unsub(); };
    }, [party?.id, character?.id, character, publish]);

    // 2026-05-15 v17: also re-publish whenever the local Necromancer
    // summon list changes (spawn / damage / despawn / clearAll) so the
    // receiver sees the updated summons within one frame instead of
    // waiting for the next 2 s heartbeat. Without this, members saw
    // stale summon state — the avatar swap toggled OFF for ~1.5 s
    // between summon spawn and the heartbeat catching up.
    useEffect(() => {
        if (!party?.id || !character) return;
        if (character.class !== 'Necromancer') return;
        const unsub = useNecroSummonStore.subscribe((s, prev) => {
            if (s.summons[character.id] === prev.summons[character.id]) return;
            const ch = useCharacterStore.getState().character;
            if (!ch) return;
            const eff = getEffectiveChar(ch);
            const effMaxHp = eff?.max_hp ?? ch.max_hp;
            const effMaxMp = eff?.max_mp ?? ch.max_mp;
            const tier = computeHighestTransformTier(useTransformStore.getState().completedTransforms);
            const cs = useCombatStore.getState();
            const inFight = cs.phase === 'fighting' || cs.phase === 'victory';
            const liveHp = inFight ? cs.playerCurrentHp : ch.hp;
            const liveMp = inFight ? cs.playerCurrentMp : ch.mp;
            publish({
                id: ch.id,
                hp: Math.min(liveHp, effMaxHp),
                maxHp: effMaxHp,
                mp: Math.min(liveMp, effMaxMp),
                maxMp: effMaxMp,
                transformTier: tier,
                maxUnlockedMonsterLevel: computeMaxUnlockedMonsterLevel(ch.level),
                skillMode: useSettingsStore.getState().skillMode,
                currentRoute: window.location.pathname,
                summons: buildSnapshotSummons(ch),
            });
        });
        return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [party?.id, character?.id, character?.class]);
};

const computeHighestTransformTier = (completed: number[] | undefined): number => {
    if (!completed || completed.length === 0) return 0;
    return Math.max(0, ...completed);
};
