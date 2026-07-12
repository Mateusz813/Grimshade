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


const PUBLISH_INTERVAL_MS = 2_000;

const ALL_MONSTERS_SORTED: IMonster[] = (monstersData as unknown as IMonster[])
    .slice()
    .sort((a, b) => a.level - b.level);

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
    const location = useLocation();
    const currentRoute = location.pathname;

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (!party?.id || !character) {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            clear();
            return;
        }

        const cleanup = subscribe(party.id);

        const sendNow = () => {
            const c = useCharacterStore.getState().character;
            if (!c) return;
            const tier = computeHighestTransformTier(useTransformStore.getState().completedTransforms);
            const eff = getEffectiveChar(c);
            const effMaxHp = eff?.max_hp ?? c.max_hp;
            const effMaxMp = eff?.max_mp ?? c.max_mp;
            const cs = useCombatStore.getState();
            const inFight = cs.phase === 'fighting' || cs.phase === 'victory';
            const liveHp = inFight ? cs.playerCurrentHp : c.hp;
            const liveMp = inFight ? cs.playerCurrentMp : c.mp;
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
                attack: eff?.attack,
                defense: eff?.defense,
                skillMode: useSettingsStore.getState().skillMode,
                currentRoute: window.location.pathname,
                summons: summonsLocal,
            });
        };

        sendNow();
        intervalRef.current = setInterval(sendNow, PUBLISH_INTERVAL_MS);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            cleanup();
        };
    }, [party?.id, character?.id]);

    const buildSnapshotSummons = (ch: { id: string; class: string } | null): IPartyMemberSnapshot['summons'] => {
        if (!ch || ch.class !== 'Necromancer') return undefined;
        return (useNecroSummonStore.getState().summons[ch.id] ?? []).map((s) => ({
            type: s.type, hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp,
        }));
    };

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
            attack: eff?.attack,
            defense: eff?.defense,
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
            attack: eff?.attack,
            defense: eff?.defense,
            skillMode,
            currentRoute,
            summons: buildSnapshotSummons(character),
        });
    }, [skillMode, party?.id, character?.id, currentRoute]);

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
                attack: eff?.attack,
                defense: eff?.defense,
                currentRoute: window.location.pathname,
                summons: buildSnapshotSummons(ch),
            });
        });
        return () => { unsub(); };
    }, [party?.id, character?.id, character, publish]);

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
                attack: eff?.attack,
                defense: eff?.defense,
                skillMode: useSettingsStore.getState().skillMode,
                currentRoute: window.location.pathname,
                summons: buildSnapshotSummons(ch),
            });
        });
        return () => { unsub(); };
    }, [party?.id, character?.id, character?.class]);
};

const computeHighestTransformTier = (completed: number[] | undefined): number => {
    if (!completed || completed.length === 0) return 0;
    return Math.max(0, ...completed);
};
