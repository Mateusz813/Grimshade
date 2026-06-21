import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useTransformStore } from '../../stores/transformStore';
import { useCombatStore } from '../../stores/combatStore';
import { useSkillStore } from '../../stores/skillStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import type { IPartyMember } from '../../systems/partySystem';
import { usePartyPresenceStore } from '../../stores/partyPresenceStore';
import { useBuffStore } from '../../stores/buffStore';
import { getCharacterAvatar } from '../../data/classAvatars';
import { useNecroSummonStore } from '../../stores/necroSummonStore';
import { getSummonImage } from '../../systems/spriteAssets';
import Spinner from '../../components/ui/Spinner/Spinner';
import Icon from '../../components/atoms/Icon/Icon';
import GameIcon from '../../components/atoms/Twemoji/GameIcon';
import { getSkillIcon } from '../../data/skillIcons';
import { useCombatFx } from '../../hooks/useCombatFx';
import { applySkillBuff, getSkillDef } from '../../systems/skillBuffs';
import { newCombatEffectsSession, ensureStatus, isCombatantStunned, castSkill as effectsCastSkill, type ICombatEffectsSession } from '../../systems/combatEffectsHelpers';
import { consumeCasterBasicHitMods, consumeTargetMarkAmp, skillTargetsEnemy, tickStatus } from '../../systems/skillEffectsV2';
import { syncCasterChargeConsume, getEffectiveChar } from '../../systems/combatEngine';
import skillsData from '../../data/skills.json';

// Stable IDs for the trainer's effect session — same convention as
// every other combat view (PLAYER_FX_ID = the local caster).
const TRAINER_PLAYER_FX_ID = 'player';
const TRAINER_DUMMY_FX_ID = (slot: number) => `trainer_dummy_${slot}`;
// 2026-05-15 v15 spec ("trainer jest archerem"): the trainer dummy
// visually IS an Archer (hooded figure with bow in the artwork), so
// every dummy-originated attack-flash overlay paints with the Archer
// class style — not the local player's class (the previous default
// flashed Knight's swing on Knight's card when the dummy hit them,
// which made no sense — the dummy is the attacker, not Knight).
const TRAINER_DUMMY_CLASS = 'Archer' as const;
import trainerImg from '../../assets/images/trainer/trainer.png';
import {
    CombatHudHost,
    CombatArena,
    CombatTopControls,
    CombatSubControls,
    CombatActionBar,
    type ICombatEnemy,
    type ICombatAlly,
    type ICombatSkillSlot,
} from '../../components/organisms/CombatUI';
import '../../components/organisms/CombatUI/CombatUI.scss';
import classesData from '../../data/classes.json';
import './Trainer.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

// Speed cycle now omits x3 per the 2026-05 redesign — only 1, 2, 4.
const SPEED_OPTIONS = [1, 2, 4];
// Module-level stable empty array. Used as a fallback for the party
// selector — without it, `?? []` would mint a fresh `[]` on every render
// and trip Zustand's `getSnapshot should be cached` infinite loop check.
// Mirror the IPartyMember shape (the live party returns) so heal pulses
// can read m.maxHp / m.isBot without the type narrowing to a stripped union.
const EMPTY_PARTY_MEMBERS: ReadonlyArray<IPartyMember> = [];
// Real-time window for the damage tracker. Scales inversely with speed:
// at x4 the in-game "5s" reads as ~1.25s of wall-clock time, at x2 it's
// 2.5s. The display label is also scaled so the player sees the correct
// real-time number ("Best 1.25s" / "Last 2.5s" etc.).
const BEST_WINDOW_BASE_MS = 5000;
const ATTACK_FLASH_MS = 350;

interface IActiveSkill {
    id: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
}

const getClassActiveSkills = (cls: string): IActiveSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    const list = (skillsData.activeSkills[key] ?? []) as IActiveSkill[];
    return list;
};

const Trainer = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const activeSkillSlots = useSkillStore((s) => s.activeSkillSlots);
    const completedTransforms = useTransformStore((s) => s.completedTransforms);
    const [speedMult, setSpeedMult] = useState(1);
    // Auto-potion is always-on in trainer (the dummy doesn't kill you,
    // and the "Trainer oddaje" toggle handles HP regen via the heal at
    // 50%) — the chip was just clutter, removed per the 2026-05 cleanup.
    const autoPotion = true;
    const [autoSkill, setAutoSkill] = useState(true);
    const [autoBasic, setAutoBasic] = useState(true);
    const [trainerAttacks, setTrainerAttacks] = useState(false);
    // 2026-05 v6: when on, every skill cast skips the per-skill cooldown
    // gate. Lets the player chain the same spell back-to-back to test
    // burst combos / charge-stacking buffs (Krok Cienia ×6) without
    // waiting 30s between casts. Toggle is local to the Trainer sandbox.
    const [noCooldowns, setNoCooldowns] = useState(false);
    // Spec 8 (2026-05): up to 4 training dummies on the field at once.
    // Player picks how many via the "+ Trainer" chip in the top control
    // strip. Each dummy is invincible and shares the same hit pulse so
    // damage stays distributed visually across the row.
    const [trainerCount, setTrainerCount] = useState(1);
    const [totalDmg, setTotalDmg] = useState(0);
    const [bestWindow, setBestWindow] = useState(0);
    const [curWindow, setCurWindow] = useState(0);
    // Bumped every status-tick so the StatusOverlay (stun / immortal
    // countdown badges on the dummy card) re-renders and visibly drains.
    // Without this the badge would freeze when no other state changes.
    const [, setStatusBeat] = useState(0);
    // 2026-05 v6: sandbox death state — Set of party-member IDs marked
    // as dead in the Trainer view. Purely cosmetic (no XP / item loss);
    // resets on view exit. Lets the player practise rez / heal / shield
    // spells on a fallen ally without going into a real fight.
    const [deadAllies, setDeadAllies] = useState<Set<string>>(new Set());
    const [killAllyPickerOpen, setKillAllyPickerOpen] = useState(false);
    // 2026-05 v6: trainer-attack target. 'player' (default) makes the
    // dummy hit the local player when `trainerAttacks` is on; setting it
    // to a party-member id makes the dummy hit that ally instead — lets
    // the player test Knight aggro_steal (Wicher / Cięcie Boga) by
    // pulling threat back, or practise tank rotations. aggro_steal cast
    // automatically resets this to 'player'.
    const [aggroTargetId, setAggroTargetId] = useState<string>('player');
    const [aggroPickerOpen, setAggroPickerOpen] = useState(false);
    // 2026-05 v6 sandbox HP/MP: Trainer is invincible — never write the
    // dummy's pokes back to characterStore (would leak post-combat lows
    // into the next real fight). Local refs hold the sandbox values so
    // Mana Shield / Trainer-attacks-on still drain visibly without
    // touching the player's persisted HP/MP.
    const sandboxHpRef = useRef<number>(0);
    const sandboxMpRef = useRef<number>(0);
    const [sandboxHp, setSandboxHp] = useState(0);
    const [sandboxMp, setSandboxMp] = useState(0);
    // 2026-05 v7: timestamp of the last Apokalipsa Śmierci cast.
    // Auto-potion (always-on in Trainer sandbox) refills sandbox HP to
    // max whenever it drops below 50% — Apokalipsa's 20% drop fell into
    // this band and got instantly erased before the player could see it.
    // The ref records when Apokalipsa fired; auto-potion checks this and
    // suppresses its refill for a 5s window so the cost stays visible.
    const apokalipsaSuppressUntilRef = useRef<number>(0);
    // Game-time accumulator for Błogosławieństwo's 1-Hz regen tick.
    // Each interval pass adds `intervalMs × speedMult` to the counter;
    // when it crosses 1000ms one regen tick fires (per-ally float +
    // HP gain). Means Blessing always heals exactly 1× per in-game
    // second, scaling with combat speed (4× per real second at x4).
    const partyHealAccumRef = useRef(0);
    // 2026-05 v6: per-bot HP overrides (sandbox). Trainer party members
    // are static 100/100 by design but when the dummy attacks them via
    // aggro picker we want their bar to actually shrink so the player
    // can see incoming damage / death + test Cleric heal / Knight
    // protection. Empty map = bots at full HP.
    const [botHpMap, setBotHpMap] = useState<Record<string, number>>({});
    // 2026-05 v6: dummy HP % slider (0..100). Used purely for hpPct
    // passed into `effectsCastSkill` so execute_below atoms (Egzekucja
    // <25%, Skrytobójstwo <20%) actually proc the IK branch even though
    // the dummy itself is invincible. Default 100 (no execute trigger).
    const [dummyHpPct, setDummyHpPct] = useState(100);
    const tickRef = useRef(0);
    const cooldownsRef = useRef<Record<string, number>>({});
    // 2026-05 v6: local effects session so Trainer can fully simulate
    // self/party buff queues (Precyzyjny crit_buff_next, Orle Oko
    // crit_buff window, Klon Cienia dmg_amp_next etc.) on basic attacks.
    // Without this the sandbox couldn't actually demonstrate that buffs
    // affect the next swing — exactly the user's complaint.
    const effectsRef = useRef<ICombatEffectsSession>(newCombatEffectsSession());
    // Per-ally per-skill cooldown maps. Keyed by `memberId -> { skillId -> tick-when-ready }`
    // so each party member's spell rotation is independent.
    const allyCooldownsRef = useRef<Record<string, Record<string, number>>>({});
    // Skill cooldowns drive the action-bar sweep; held in state (not a
    // ref) so the bar re-renders without an explicit trigger and the
    // render reads only its own props/state — keeping the React-19 purity
    // checker happy.
    const [skillCooldownsMs, setSkillCooldownsMs] = useState<Record<string, number>>({});
    const windowEventsRef = useRef<Array<{ at: number; dmg: number }>>([]);
    // Pulse counters drive the per-card flash overlays. Each basic / spell
    // hit on the dummy increments dummyHitPulse; each trainer-counter-hit
    // increments playerHitPulse so the player's card shows it took the
    // hit even though the float number is small (1 HP).
    const [dummyHitPulse, setDummyHitPulse] = useState(0);
    const [playerHitPulse, setPlayerHitPulse] = useState(0);
    const [dummyAttackingClass, setDummyAttackingClass] = useState<string | null>(null);
    const [playerAttackingClass, setPlayerAttackingClass] = useState<string | null>(null);
    // 2026-05-15 v15 spec ("animacja ataku potwora pokazuje sie ale
    // na samym potworze a nie na targetowanym sojuszniku"): per-ally
    // attacking-class map. Keyed by member.id, values are the css
    // class to apply (e.g. `attack-Archer`). The receiver subscriber
    // sets an entry when the trainer hits any party slot; the
    // renderer reads `allyAttackingClassMap[m.id]` for each ally card.
    // Clears after ATTACK_FLASH_MS.
    const [allyAttackingClassMap, setAllyAttackingClassMap] = useState<Record<string, string>>({});
    // Animation overlays — same hook every other combat view uses, so the
    // per-class spell-glyph and float numbers look identical here.
    const fx = useCombatFx();

    const myAttack = character?.attack ?? 10;
    const myColor = character ? CLASS_COLORS[character.class] ?? '#888' : '#888';

    // 2026-05 v6: initialise sandbox HP/MP to character max once on mount
    // (and whenever max changes — class swap / level up). Trainer is a
    // sandbox; we don't want the previous combat's leftover HP to leak
    // into the bars here. Real characterStore.hp/mp stays untouched the
    // entire visit, so leaving Trainer drops the player back to their
    // actual HP from before they walked in.
    //
    // 2026-05 v7: dropped `character` from deps — keeping it caused an
    // infinite loop with the sandbox->header mirror effect below. When
    // sandboxHp dropped (Apokalipsa Śmierci self-cost), the mirror
    // updated `character.hp` in the store; the new `character`
    // reference fed back into THIS effect's deps, which immediately
    // reset sandboxHp to `character.max_hp` (=full HP). The result:
    // every cast that should have lowered HP instantly snapped back
    // to 100%. With only `max_hp` / `max_mp` watched, the effect
    // re-fires on level-ups and equipment swaps but ignores hp/mp
    // changes, breaking the loop.
    useEffect(() => {
        if (!character) return;
        // 2026-05 v7: use EFFECTIVE max (base + equipment + training +
        // elixirs + transform). Pre-fix sandboxHp seeded with BASE
        // max_hp, so the mirror wrote `character.hp = base` even when
        // effective max was much higher. The TopHeader (and the
        // character-select view) then displayed `base / effective` —
        // e.g. 83% when equipment adds +17% HP — making it look like
        // the player lost HP just by visiting Trainer.
        const eff = getEffectiveChar(character);
        const effMaxHp = eff?.max_hp ?? character.max_hp;
        const effMaxMp = eff?.max_mp ?? character.max_mp;
        sandboxHpRef.current = effMaxHp;
        sandboxMpRef.current = effMaxMp;
        setSandboxHp(effMaxHp);
        setSandboxMp(effMaxMp);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [character?.max_hp, character?.max_mp]);

    // 2026-05 v7: mirror sandbox HP/MP -> characterStore so the global
    // TopHeader bars reflect every fight event (basic-damage tick,
    // self-heal cast, Apokalipsa Śmierci self-cost). Pre-fix the header
    // stayed pinned at 100% / 100% the whole Trainer visit even after
    // a 500-MP Apokalipsa drained the player to 20% — completely
    // invisible feedback. The mount effect below still snapshots the
    // pre-Trainer HP/MP and restores them on unmount, so leaving Trainer
    // returns the player to their real persistent values.
    useEffect(() => {
        const live = useCharacterStore.getState().character;
        if (!live) return;
        // 2026-05 v7: skip the very first render where sandboxHp/sandboxMp
        // are still useState(0) — without this gate the mirror writes
        // hp=0 to characterStore BEFORE the sandbox-init effect's
        // setSandboxHp(max_hp) settles, AND before the snapshot effect
        // captures the real pre-Trainer hp. Net effect: snapshotHp=0,
        // so leaving Trainer restored hp=0 in town. Treating both 0 as
        // "uninitialized state, skip" breaks the loop.
        if (sandboxHp === 0 && sandboxMp === 0) return;
        // 2026-05 v7: clamp to EFFECTIVE max (base + eq + training +
        // elixirs + transform). Pre-fix clamped to `live.max_hp` (base)
        // so even when sandboxHp was at the displayed 100% (effective
        // max), the mirror wrote a smaller `base`-sized value — the
        // TopHeader % bar then showed `base / effective` instead of
        // 100%. Now both sides use the same scale.
        const liveEff = getEffectiveChar(live);
        const effMaxHp = liveEff?.max_hp ?? live.max_hp;
        const effMaxMp = liveEff?.max_mp ?? live.max_mp;
        const clampedHp = Math.max(0, Math.min(effMaxHp, sandboxHp));
        const clampedMp = Math.max(0, Math.min(effMaxMp, sandboxMp));
        useCharacterStore.getState().updateCharacter({ hp: clampedHp, mp: clampedMp });
    }, [sandboxHp, sandboxMp]);

    // 2026-05 v6: TopHeader reads characterStore.hp/mp directly (it's the
    // global player chrome). Without this snapshot dance, the player
    // walks into Trainer at e.g. 57% HP from a previous Boss fight and
    // the header bars look broken even though the Trainer arena pretends
    // they're full. Snapshot real HP/MP on mount, force them to max
    // (header looks fresh), restore the snapshot on unmount so leaving
    // Trainer drops the player back to reality.
    useEffect(() => {
        const ch0 = useCharacterStore.getState().character;
        if (!ch0) return;
        const snapshotHp = ch0.hp;
        const snapshotMp = ch0.mp;
        // 2026-05 v7: force HP/MP to EFFECTIVE max on Trainer entry so
        // the bars show 100% (base + equipment + training + elixirs +
        // transform). Pre-fix used `ch0.max_hp` (base) which made the
        // TopHeader bar show base / effective ≈ 83% even at "full HP".
        const ch0Eff = getEffectiveChar(ch0);
        const ch0EffMaxHp = ch0Eff?.max_hp ?? ch0.max_hp;
        const ch0EffMaxMp = ch0Eff?.max_mp ?? ch0.max_mp;
        useCharacterStore.getState().updateCharacter({
            hp: ch0EffMaxHp,
            mp: ch0EffMaxMp,
        });
        // 2026-05 v7: clear leftover Necromancer summons from the
        // previous combat so a Trainer session starts with a clean
        // necro card. Without this the player walked into Trainer
        // already showing skeletons / ghosts from their last Boss /
        // Hunt / Dungeon fight (the summon store is global and
        // persists until the view explicitly clears it).
        useNecroSummonStore.getState().clear(TRAINER_PLAYER_FX_ID);
        if (ch0.id) useNecroSummonStore.getState().clear(ch0.id);
        // 2026-05 v7: reset Apokalipsa auto-potion suppress on every
        // Trainer entry so a fresh session has auto-refill enabled
        // (until the next Apokalipsa cast permanently turns it off).
        apokalipsaSuppressUntilRef.current = 0;
        return () => {
            const live = useCharacterStore.getState().character;
            if (!live) return;
            // 2026-05 v7 (final): on Trainer exit, leave whatever HP/MP
            // the mirror wrote during the session. If the player cast
            // Apokalipsa Śmierci and dropped to 20%, they walk back to
            // town with 20% — the cost was real, not a sandbox illusion.
            // Per user spec "po wyjsciu HP nie powinno wracac do 100%".
            //
            // Safety guards:
            //   - If somehow live.hp === 0 (snapshot race wrote 0,
            //     auto-potion suppress was active, etc.) restore to
            //     snapshotHp if non-zero, else live.max_hp. Prevents
            //     the "0/4345 in town, can't fight anything" trap.
            //   - Clamp to live.max_hp in case max changed mid-session
            //     (level-up).
            const currentHp = live.hp;
            const currentMp = live.mp;
            // 2026-05 v7: clamp on EFFECTIVE max so 100% in Trainer
            // remains 100% in town (base + equipment + training etc.).
            const liveEffOut = getEffectiveChar(live);
            const effMaxHpOut = liveEffOut?.max_hp ?? live.max_hp;
            const effMaxMpOut = liveEffOut?.max_mp ?? live.max_mp;
            let finalHp = currentHp;
            let finalMp = currentMp;
            if (currentHp === 0) {
                finalHp = snapshotHp > 0 ? Math.min(effMaxHpOut, snapshotHp) : effMaxHpOut;
            } else {
                finalHp = Math.max(1, Math.min(effMaxHpOut, currentHp));
            }
            if (currentMp === 0 && snapshotMp > 0) {
                finalMp = Math.min(effMaxMpOut, snapshotMp);
            } else {
                finalMp = Math.max(0, Math.min(effMaxMpOut, currentMp));
            }
            useCharacterStore.getState().updateCharacter({
                hp: finalHp,
                mp: finalMp,
            });
            // Drop summons on the way out too — same idea as in/out
            // symmetry for the next combat view's fresh start.
            useNecroSummonStore.getState().clear(TRAINER_PLAYER_FX_ID);
            if (live.id) useNecroSummonStore.getState().clear(live.id);
        };
        // Mount-only — re-snapshotting on character churn would lose the
        // original pre-Trainer values mid-visit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Subscribe to party — when the player joined a group their party
    // members (real allies or bots) should appear in the trainer arena
    // alongside the player so dummy-DPS practice mirrors actual combat.
    // Subscribe to the inner `members` directly with a stable empty
    // fallback — earlier we used `s.party?.members ?? []`, but the
    // inline `[]` was a fresh reference every call and Zustand's
    // identity check kicked off the "getSnapshot should be cached"
    // infinite loop. The constant outside the component keeps the
    // reference stable across renders when the player has no party.
    const partyMembers = usePartyStore((s) => s.party?.members ?? EMPTY_PARTY_MEMBERS);

    // 2026-05-15 spec ("Sojusznicy nie lider moga tylko klikac auto
    // skille i czy chca atakowac trainera, reszte kontrolek moze
    // tylko lider klikac"): derive leader / non-leader roles so the
    // top-controls + extras chips can be gated. iAmLeader is "I'm
    // the leader AND there's at least one OTHER human in the party"
    // — solo + bots-only counts as leader-of-self (no gating needed,
    // every chip is theirs). isNonLeaderMember is the inverse for
    // members who joined via the ready-check. Use the full party
    // object for the multi-human probe because the trimmed
    // `EMPTY_PARTY_MEMBERS` fallback type doesn't carry `isBot`.
    const partyForRole = usePartyStore((s) => s.party);
    const partyLeaderId = partyForRole?.leaderId ?? null;
    const isMultiHumanParty = !!partyForRole && partyForRole.members.some(
        (m) => m.id !== character?.id && !m.isBot,
    );
    const iAmLeader = isMultiHumanParty && partyLeaderId === character?.id;
    const isNonLeaderMember = isMultiHumanParty && partyLeaderId !== character?.id;

    // 2026-05-19 v20 spec ("DPS party sie nie zapisuje, jezeli walcze
    // z botami to napisz np w miejscu pierwszym 4 nicki jeden pod
    // drugim z ikonkami klasy i na koncu na srodku po prawej DPS
    // laczny"): party DPS now counts ANY party (humans or bots) —
    // the previous `isMultiHumanParty` gate meant bot-only parties
    // counted as "solo". Switch column based on `partyForRole`.
    //
    // On every new high-water DPS we ALSO push a composition snapshot
    // (JSON of `{ name, class }` per member) so the leaderboard can
    // render the full party roster next to the score. Solo runs leave
    // the composition column NULL.
    //
    // Skipped entirely while `noCooldowns` is on — uncapped cooldowns
    // are a sandbox toggle, not a real combat reflection.
    const lastPushedDpsRef = useRef(0);
    useEffect(() => {
        if (!character) return;
        if (noCooldowns) return;
        if (bestWindow <= 0) return;
        if (bestWindow <= lastPushedDpsRef.current) return;
        const localBest = bestWindow;
        const inParty = !!partyForRole;
        const composition = inParty && partyForRole
            ? JSON.stringify(partyForRole.members.map((m) => ({
                name: m.name,
                class: m.class,
            })))
            : null;
        const t = window.setTimeout(() => {
            lastPushedDpsRef.current = localBest;
            void import('../../api/v1/characterApi').then(({ characterApi }) => {
                void characterApi.bumpStat({
                    characterId: character.id,
                    column: inParty ? 'best_dps5_party' : 'best_dps5_solo',
                    value: localBest,
                    mode: 'max',
                });
                // Composition is overwritten only when we're pushing
                // a party score — direct PATCH because bumpStat is
                // number-typed; composition is a JSON string.
                if (inParty && composition) {
                    void characterApi.updateCharacter(character.id, {
                        best_dps5_party_composition: composition,
                    }).catch(() => { /* offline */ });
                }
            }).catch(() => { /* offline */ });
        }, 800);
        return () => window.clearTimeout(t);
    }, [bestWindow, noCooldowns, character, partyForRole]);

    // Weapon-damage roll. Mirrors the engine's internal helper of the
    // same name: pulls the equipped main hand, returns a uniform random
    // pick between dmg_min and dmg_max so every basic swing varies. Was
    // missing from the trainer before — every hit on the dummy showed
    // the same flat number ("262 262 262 …") which the player flagged
    // as "why does this not vary like the rest of the game".
    const rollWeaponDamage = useCallback((): number => {
        const equipment = useInventoryStore.getState().equipment;
        const weapon = equipment.mainHand;
        if (!weapon) return 0;
        const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
        const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
        if (dmgMax <= 0) return 0;
        return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
    }, []);

    // 2026-05 v6: Off-hand dagger roll for dual-wield classes (Rogue
    // and Knight when both slots carry weapons). Mirrors the hunt
    // engine's `rollOffHandDamage` so each twin-strike swing pulls
    // its own min/max range. Returns 0 when no off-hand is equipped.
    const rollOffHandDamage = useCallback((): number => {
        const equipment = useInventoryStore.getState().equipment;
        const weapon = equipment.offHand;
        if (!weapon) return 0;
        const dmgMin = weapon.bonuses.dmg_min ?? weapon.bonuses.attack ?? 0;
        const dmgMax = weapon.bonuses.dmg_max ?? dmgMin;
        if (dmgMax <= 0) return 0;
        return dmgMin + Math.floor(Math.random() * (dmgMax - dmgMin + 1));
    }, []);

    // Roll a single basic-attack damage number. Adds a ±20% variance on
    // top of the weapon roll to spread the spread further; mirrors what
    // doPlayerAttackTick does in the hunt engine so trainer DPS readouts
    // line up with what the player actually does in real fights.
    // `dmgPercent` mirrors the hunt engine's per-hit scale — dual-wield
    // hits use 0.6 (60%) so two strikes total ~120% of a single hit.
    const rollBasicHit = useCallback((dmgPercent: number = 1.0, useOffHand: boolean = false): number => {
        const wRoll = useOffHand ? rollOffHandDamage() : rollWeaponDamage();
        const scaled = Math.floor(wRoll * dmgPercent);
        const total = Math.floor(myAttack * dmgPercent) + scaled;
        const base = Math.max(1, total);
        const variance = Math.floor(base * 0.2);
        return Math.max(1, base - variance + Math.floor(Math.random() * (variance * 2 + 1)));
    }, [rollWeaponDamage, rollOffHandDamage, myAttack]);
    // Dual-wield detection: class flag + actually has an off-hand
    // weapon equipped (Knight without off-hand falls back to single).
    const isDualWieldRef = useRef(false);
    isDualWieldRef.current = (() => {
        const cfg = (classesData as ReadonlyArray<{ id: string; dualWield?: boolean }>)
            .find((c) => c.id === character?.class);
        if (!cfg?.dualWield) return false;
        const off = useInventoryStore.getState().equipment.offHand;
        if (!off) return false;
        // Off-hand must actually carry a damage stat to count as a
        // weapon (a shield with hp/def doesn't qualify).
        const dmgMax = off.bonuses.dmg_max ?? off.bonuses.attack ?? 0;
        return dmgMax > 0;
    })();
    // Transform-tinted accent for HUD chrome (chips, skill borders, etc.)
    const transformColor = useTransformStore((s) => s.getHighestTransformColor);
    const playerAccent = (() => {
        const tc = transformColor();
        return tc?.solid ?? tc?.gradient?.[0] ?? myColor;
    })();

    // Mirror to the shared combat session feed so the unified
    // CombatLogsModal sees the same stream every other view sees. Trainer
    // never produces drops/kills (dummy is invincible) — only log lines flow.
    const addLog = useCallback((t: string) => {
        useCombatStore.getState().addSessionLog(t, 'system');
    }, []);

    // Reset shared session on mount so the trainer's log popup starts clean.
    useEffect(() => {
        useCombatStore.getState().clearCombatSession();
    }, []);

    // 2026-05-15 v8 spec ("Zrob moze tak ze jak sie klika Brak CD to
    // wszystkim od razu cooldowny spadaja do zera instant i wtedy to
    // naprawi problem"): when `noCooldowns` flips ON (whether the
    // local player flipped the chip OR the leader's broadcast
    // arrived), wipe every cooldown bucket so the action-bar sweep
    // jumps to 0 right away and the next click can fire
    // immediately. Without this the chip read "ON" but the existing
    // cooldowns from the last few casts kept counting down silently
    // and members felt their spells were still locked.
    useEffect(() => {
        if (!noCooldowns) return;
        cooldownsRef.current = {};
        allyCooldownsRef.current = {};
        setSkillCooldownsMs({});
    }, [noCooldowns]);

    // 2026-05-15 v2 spec ("jak lider party zmieni jakas opcje to
    // wszyscy powinni widziec ta zmiane poza auto atakiem i auto
    // spellami") + v3 ("Dalem target zeby trainer bil Krasek a na
    // jednym ekranie bije jedna postac a na drugiej inna"): leader
    // broadcasts every chip + the deadAllies set. The aggro target
    // is resolved from the local `'player'` sentinel to the
    // leader's actual character.id BEFORE broadcast — that way every
    // client agrees on the target card (the sentinel resolves
    // locally to "the broadcaster" on the leader's screen but
    // would point at the RECEIVER on a member's screen, which is the
    // bug the user reported). autoBasic / autoSkill stay per-client.
    useEffect(() => {
        if (!iAmLeader || !character) return;
        const broadcastTarget = aggroTargetId === 'player' ? character.id : aggroTargetId;
        // 2026-05-15 v6: surface the leader's OWN sandboxHp as a
        // percentage (so members' card bars render the leader's
        // current HP / max HP through the standard bot-HP path). The
        // leader's real sandbox pool drains in sandboxHpRef on every
        // hit (capped at character.max_hp); we publish a 0..100
        // scaled value so the receiver's existing `currentHp = bot
        // HpMap[leader.id] ?? 100` math works without changes.
        const leaderHpPct = character.max_hp > 0 ? Math.max(0, Math.min(100, Math.round((sandboxHp / character.max_hp) * 100))) : 100;
        const broadcastBotMap = { ...botHpMap, [character.id]: leaderHpPct };
        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
            usePartyCombatSyncStore.getState().publishTrainerState({
                speedMult: speedMult as 1 | 2 | 4,
                trainerAttacks,
                noCooldowns,
                trainerCount,
                dummyHpPct,
                aggroTargetId: broadcastTarget,
                deadAllyIds: Array.from(deadAllies),
                totalDmg,
                curWindowDmg: curWindow,
                bestWindowDmg: bestWindow,
                leaderSandboxHp: sandboxHp,
                leaderSandboxMp: sandboxMp,
                memberSandboxHpMp: {},
                botHpMap: broadcastBotMap,
            });
        }).catch(() => { /* offline */ });
    }, [iAmLeader, character, speedMult, trainerAttacks, noCooldowns, trainerCount, dummyHpPct, aggroTargetId, deadAllies, totalDmg, curWindow, bestWindow, sandboxHp, sandboxMp, botHpMap]);

    // 2026-05-15 v3: subscribe to OTHER party members' trainer
    // attacks and render the float + class swing on the attacker's
    // ally slot. Self-events are filtered (we already rendered our
    // own swing locally) and only fires when at least one other
    // human is in the party — solo / bots-only keeps the legacy
    // local simulation. Each broadcast carries the actual
    // character.id so `slotOfMember` resolves to the correct card
    // on every client.
    const lastTrainerAttackSeenRef = useRef<Record<string, unknown>>({});
    useEffect(() => {
        if (!isMultiHumanParty || !character) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const initial = usePartyCombatSyncStore.getState().lastTrainerAttackByAttacker;
            for (const [k, v] of Object.entries(initial)) {
                lastTrainerAttackSeenRef.current[k] = v;
            }
            return usePartyCombatSyncStore.subscribe((state) => {
                const map = state.lastTrainerAttackByAttacker;
                if (!map) return;
                for (const [key, ev] of Object.entries(map)) {
                    if (ev === lastTrainerAttackSeenRef.current[key]) continue;
                    lastTrainerAttackSeenRef.current[key] = ev;
                    // Skip our own broadcast (we already rendered it).
                    if (ev.attackerId === character.id) continue;
                    // 2026-05-15 v12 spec ("dlaczego tam sa 2 liczby a
                    // nie jedna"): monster events come from the LEADER
                    // (only leader runs the trainer-attack tick), so
                    // when the leader's own subscriber receives back
                    // its own monster broadcast we need to drop it —
                    // the local tick ALREADY pushed the float. Without
                    // this guard the leader's view rendered the same
                    // hit twice (one local push + one received from
                    // the channel), explaining the "355 355" pair
                    // the user reported.
                    if (ev.attackerId === 'monster' && iAmLeader) continue;
                    // 2026-05-15 v9 spec ("Inni sojusznicy nie widza
                    // tez ze mnie atakuje i ile zabiera mi HP
                    // przeciwnik"): monster->ally events carry a
                    // `targetAllyId` instead of a dummy index. Render
                    // a red 'monster' float on the targeted ally's
                    // slot + a hit pulse on their card.
                    if (ev.kind === 'monster' && ev.targetAllyId) {
                        const targetSlot = slotOfMemberLive(ev.targetAllyId);
                        if (targetSlot < 0) continue;
                        fx.pushAllyFloat(targetSlot, ev.damage, 'monster', {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        // Bump the appropriate hit pulse so the
                        // target's card shakes red.
                        if (ev.targetAllyId === character.id) {
                            setPlayerHitPulse((p) => p + 1);
                            // 2026-05-15 v15 spec ("animacja ataku
                            // potwora ... to ma byc animacja ataku
                            // potwora a nie klasy sojusznika"): fire
                            // the strike overlay on our card using
                            // the broadcast `attackerClass` (which
                            // the publisher now sets to
                            // TRAINER_DUMMY_CLASS). Pre-v15 used
                            // `character.class` which painted Knight
                            // / Mage / etc. style strikes on the
                            // target's own card — wrong, the dummy is
                            // the attacker.
                            setPlayerAttackingClass(`attack-${ev.attackerClass}`);
                            window.setTimeout(() => setPlayerAttackingClass(null), ATTACK_FLASH_MS);
                        } else {
                            // 2026-05-15 v15 spec ("a powinna na
                            // targetowanym sojuszniku"): paint the
                            // strike overlay on the TARGETED ally's
                            // slot via the per-ally map — NOT on the
                            // dummy. The previous `setDummyAttacking
                            // Class` made the dummy flash with the
                            // attacker's class, but the strike
                            // visually represents the dummy hitting
                            // the target — so the animation belongs
                            // on the TARGET card.
                            const targetIdCap = ev.targetAllyId;
                            setAllyAttackingClassMap((prev) => ({ ...prev, [targetIdCap]: `attack-${ev.attackerClass}` }));
                            window.setTimeout(() => {
                                setAllyAttackingClassMap((prev) => {
                                    if (!prev[targetIdCap]) return prev;
                                    const next = { ...prev };
                                    delete next[targetIdCap];
                                    return next;
                                });
                            }, ATTACK_FLASH_MS);
                        }
                        // pushDamage NOT called — monster-on-ally is
                        // damage TAKEN, not dealt; it doesn't belong
                        // in the shared dealt-damage counter.
                        continue;
                    }
                    // 2026-05-15 v5: pure-buff casts ship damage=0 +
                    // label="BUFF". They animate on the CASTER's
                    // ally slot only — no dummy float / pulse /
                    // class swing. Damage-bearing hits (basics,
                    // skills, DOTs, splashes) fall into the normal
                    // pulse + dummy float path below.
                    const isBuffCast = ev.damage === 0 && ev.label === 'BUFF';
                    if (!isBuffCast) {
                        // Damage counter — every client tracks the
                        // SHARED session DPS so all three boxes
                        // (totalDmg / cur5s / best5s) line up.
                        pushDamage(ev.damage);
                        setDummyHitPulse((p) => p + 1);
                        // 2026-05-15 v7 spec ("Nasz atak jest bialy a
                        // sojusznika blekitny ... Na kazdym ekranie
                        // kazdy swoj cios widzi bialy"): remap the
                        // caster-relative kind to the RECEIVER's
                        // perspective — every hit from a different
                        // character should read as ally-* (light
                        // blue) instead of basic/spell (white) so
                        // each client can tell THEIR own hits apart
                        // from teammates'. `basic` -> `ally-basic`,
                        // `spell` -> `ally-spell`; `ally-*` and
                        // `monster*` pass through unchanged.
                        const remappedKind: typeof ev.kind = ev.kind === 'basic'
                            ? 'ally-basic'
                            : ev.kind === 'spell'
                                ? 'ally-spell'
                                : ev.kind;
                        // Dummy float — same icon/label the attacker
                        // saw locally so members read identical
                        // numbers; kind is recolored per receiver.
                        fx.pushEnemyFloat(ev.dummyIdx ?? 0, ev.damage, remappedKind, {
                            icon: ev.icon,
                            label: ev.label,
                            isCrit: ev.isCrit,
                        });
                        // Class swing flash on the dummy.
                        setDummyAttackingClass(`attack-${ev.attackerClass}`);
                        window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                    }
                    // Skill cast -> fire the themed enemy overlay so
                    // every client sees the same fire / arrow / etc.
                    // glyph fly toward the dummy. Buff casts skip
                    // the dummy overlay and only animate the caster.
                    if (ev.skillId) {
                        if (!isBuffCast) {
                            fx.triggerEnemySkillAnim(ev.dummyIdx ?? 0, ev.skillId);
                        }
                        // Caster's ally-slot animation — mirrors the
                        // local cast-anim path.
                        const slot = slotOfMemberLive(ev.attackerId);
                        if (slot >= 0) fx.triggerAllySkillAnim(slot, ev.skillId);
                        // 2026-05-15 v8 spec ("Buff Orle oko nie
                        // widac ze uzywam u innych napraw"): for
                        // pure-buff casts (damage=0, label='BUFF')
                        // push a :sparkles: BUFF float on the caster's slot
                        // so every client sees a visible cue that
                        // a self-buff (Orle Oko / Krok Cienia /
                        // Bomba Dymna / etc.) was used — even when
                        // the atoms are caster-only and don't
                        // propagate via applySkillBuff to the
                        // receiver's BuffBar.
                        if (isBuffCast && slot >= 0) {
                            fx.pushAllyFloat(slot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
                        }
                        // 2026-05-15 v3 spec ("nie dostaja im sie a
                        // powinny w zakladce z buffami"): when the
                        // skill has party-affecting atoms, apply the
                        // FILTERED buff locally so the receiver's
                        // BuffBar shows the entry. Caster-only atoms
                        // are stripped to avoid the receiver gaining
                        // buffs that should stay on the caster.
                        const sd = getSkillDef(ev.skillId);
                        if (sd?.effect) {
                            const PARTY_PREFIX = ['party_', 'block_next_party', 'next_ally_heal', 'enemy_'];
                            const atoms = sd.effect.split(';');
                            const partyEffect = atoms
                                .filter((atom) => {
                                    const head = atom.trim().toLowerCase().split(':')[0];
                                    return PARTY_PREFIX.some((p) => head === p || head.startsWith(p));
                                })
                                .join(';');
                            if (partyEffect) {
                                applySkillBuff(ev.skillId, { ...sd, effect: partyEffect }, speedMult);
                            }
                            // 2026-05-15 v6 spec ("Tak samo ma sie
                            // pokazac u gory, kazdy sojusznik ma tak
                            // samo te spelle widziec"): when the
                            // broadcast skill carries an ally-wide
                            // buff atom (party_immortal / party_*_up
                            // / next_ally_heal / etc.), push the
                            // matching 'IMMORTAL' / ':musical-note: BUFF' / '+REZ'
                            // float on every visible party slot so
                            // every client renders the same row of
                            // labels the caster's local code already
                            // does.
                            const hasPartyImmortal = atoms.some((a) => a.trim().toLowerCase().startsWith('party_immortal'));
                            const hasGenericPartyBuff = atoms.some((a) => {
                                const head = a.trim().toLowerCase().split(':')[0];
                                return head === 'party_attack_up' || head === 'party_defense_up' || head === 'party_as_up' || head === 'party_crit_up' || head === 'party_def_pen' || head === 'party_lifesteal_next';
                            });
                            if (hasPartyImmortal) {
                                for (const m of orderedMembersRef.current) {
                                    const idx = slotOfMemberLive(m.id);
                                    if (idx < 0) continue;
                                    fx.triggerAllySkillAnim(idx, ev.skillId);
                                    fx.pushAllyFloat(idx, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                                }
                            } else if (hasGenericPartyBuff) {
                                for (const m of orderedMembersRef.current) {
                                    const idx = slotOfMemberLive(m.id);
                                    if (idx < 0) continue;
                                    fx.triggerAllySkillAnim(idx, ev.skillId);
                                    fx.pushAllyFloat(idx, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                                }
                            }
                        }
                    }
                }
            });
        })();
        return () => { void unsub.then((fn) => fn?.()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMultiHumanParty, character?.id, iAmLeader]);

    // Member-side: subscribe to the leader's trainer-state broadcasts
    // and mirror every chip's value + the deadAllies set into local
    // state. autoBasic / autoSkill are deliberately NOT touched —
    // they stay per-client per spec. The aggroTargetId comes in as a
    // real character id (resolved by the leader before publishing)
    // so members can resolve it via `slotOfMember` on their own
    // roster and the dummy hits the correct card on every screen.
    const lastTrainerStateSeenRef = useRef<number>(0);
    useEffect(() => {
        if (!isNonLeaderMember) return;
        const unsub = (async () => {
            const { usePartyCombatSyncStore } = await import('../../stores/partyCombatSyncStore');
            const apply = (s: { speedMult: number; trainerAttacks: boolean; noCooldowns: boolean; trainerCount: number; dummyHpPct: number; aggroTargetId: string; deadAllyIds: string[]; totalDmg: number; curWindowDmg: number; bestWindowDmg: number; leaderSandboxHp: number; leaderSandboxMp: number; memberSandboxHpMp: Record<string, { hp: number; mp: number }>; botHpMap: Record<string, number>; sentAt: number } | null) => {
                if (!s) return;
                if (s.sentAt <= lastTrainerStateSeenRef.current) return;
                lastTrainerStateSeenRef.current = s.sentAt;
                // 2026-05-15 v7 spec ("Wylaczylem cooldowny a knight i
                // tak ma wlaczone caly cza"): force-set every chip
                // value on every snapshot. The previous "only set
                // when different" guard read stale closure state
                // (`noCooldowns` here is the value at the time the
                // useEffect was registered, not the live one), so
                // a leader-toggle that happened after mount could
                // be silently ignored.
                setSpeedMult(s.speedMult as 1 | 2 | 4);
                setTrainerAttacks(s.trainerAttacks);
                setNoCooldowns(s.noCooldowns);
                setTrainerCount(s.trainerCount);
                setDummyHpPct(s.dummyHpPct);
                setAggroTargetId(s.aggroTargetId);
                // 2026-05-15 v3 + v7: sync the sandbox-killed set.
                // Always replace (cheap React diff catches no-op set
                // — Set identity is what counts). Skip the size+
                // contents pre-check that could miss an empty-vs-
                // empty re-arming roll.
                setDeadAllies(new Set(s.deadAllyIds ?? []));
                // Shared damage counters — leader-authoritative.
                if (typeof s.totalDmg === 'number') setTotalDmg(s.totalDmg);
                if (typeof s.curWindowDmg === 'number') setCurWindow(s.curWindowDmg);
                if (typeof s.bestWindowDmg === 'number') setBestWindow(s.bestWindowDmg);
                // botHpMap — replace wholesale every snapshot.
                if (s.botHpMap) setBotHpMap(s.botHpMap);
            };
            apply(usePartyCombatSyncStore.getState().lastTrainerState);
            return usePartyCombatSyncStore.subscribe((state) => apply(state.lastTrainerState));
        })();
        return () => { void unsub.then((fn) => fn?.()); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isNonLeaderMember]);

    // 2026-05-15 spec ("Na trainerze taka sama kolejnosc jak u gory
    // powinna byc") + v4 ("Jak ktos wychodzi z treningu nie wywala go
    // na 2 ekranie u innych uczestnikow"): every client builds an
    // identical stable list of up to 4 visible members from
    // `party.members`, but FILTERS out humans who aren't currently
    // on `/trainer` per their broadcast `currentRoute` (each member's
    // local router publishes pathname via partyPresenceStore). The
    // local player is ALWAYS kept (we're obviously on /trainer
    // ourselves). Bots are always kept (no per-bot router). When a
    // human navigates away their card disappears within ~500 ms (one
    // presence throttle window). Solo (empty partyMembers) renders
    // as single-slot self at index 0 via a phantom-self fallback.
    const presenceByMember = usePartyPresenceStore((s) => s.byMember);
    const orderedMembers = (() => {
        if (partyMembers.length === 0) {
            return character
                ? ([{ id: character.id, name: character.name, class: character.class, level: character.level, color: myColor, hp: 0, maxHp: 0, mp: 0, maxMp: 0, attack: 0, defense: 0, isLeader: true, isBot: false, isDead: false, joinedAt: 0 }] as unknown as typeof partyMembers)
                : [];
        }
        // 2026-05-15 v11 spec ("na widoku innego sojusznika
        // targetowany jest Knight a animacja jest na Krasek"): every
        // client MUST produce an identical `orderedMembers` array so
        // `slotOfMember(memberId)` resolves to the same slot index
        // on every screen. `partyMembers` order from the partyStore
        // can differ between clients (server-side row ordering vs.
        // local cache, react-query refetch races, etc.), so we
        // explicitly sort by character.id — a stable, identical key
        // on every browser. Without this the same target id resolved
        // to different slots on different clients, landing the
        // monster-hit float on the wrong card.
        return partyMembers
            .filter((m) => {
                if (m.id === character?.id) return true;       // self always visible
                if (m.isBot) return true;                       // bots have no router
                const route = presenceByMember[m.id]?.currentRoute;
                // Undefined route = older client / first second
                // after join — treat as "still in trainer" so we
                // don't strobe the card off-and-back-on. Once
                // their next heartbeat lands the filter snaps to
                // the truth.
                if (route === undefined) return true;
                return route === '/trainer';
            })
            .slice()
            .sort((a, b) => a.id.localeCompare(b.id))
            .slice(0, 4);
    })();
    const mySlot = (() => {
        const idx = orderedMembers.findIndex((m) => m.id === character?.id);
        return idx >= 0 ? idx : 0;
    })();
    const slotOfMember = (memberId: string): number => {
        return orderedMembers.findIndex((m) => m.id === memberId);
    };
    // 2026-05-15 v12 spec ("na dolnym ekranie sojusznika animacja
    // otrzymywanych obrazen pokazuje na mnie liderze a powinno na
    // sojuszniku ktorego wybralem"): the trainer-attack subscriber
    // closes over `slotOfMember` (and through it `orderedMembers`)
    // at subscribe time, so a later party.members reshuffle or
    // presence flip wouldn't update the slot math inside the
    // subscriber. Pin the live `orderedMembers` in a ref so every
    // received event resolves slots against the CURRENT roster, not
    // the closure snapshot from when the subscriber mounted.
    const orderedMembersRef = useRef(orderedMembers);
    orderedMembersRef.current = orderedMembers;
    const slotOfMemberLive = (memberId: string): number => {
        return orderedMembersRef.current.findIndex((m) => m.id === memberId);
    };

    const pushDamage = useCallback((dmg: number) => {
        // 2026-05-15 v6 spec ("TO ma byc wspolny widok jak sie jest
        // w party"): in a multi-human party, members never mutate
        // their own counter. The leader's trainer-state broadcast
        // carries authoritative `totalDmg / curWindowDmg / best
        // WindowDmg` and the receiver mirrors those values, so the
        // numbers on every screen are 1:1. Member-side local hits
        // do NOT pushDamage — they broadcast the attack and the
        // leader's engine accumulates + republishes.
        if (isMultiHumanParty && !iAmLeader) return;
        setTotalDmg((v) => v + dmg);
        const now = Date.now();
        windowEventsRef.current.push({ at: now, dmg });
        // 2026-05-15 v8 spec ("U sojusznikow statystyka ostatnie 5s
        // caly czas skacze z 0 na konkretna wartosc niech tak nie
        // przeskakuje caly czas na 0"): use a FIXED 5s wall-clock
        // window regardless of speedMult. The previous formula
        // (5000 / speedMult) gave a 1.25s window at X4 — any pause
        // longer than that flashed the box to 0 on the leader's
        // view, and the member mirrored that flicker through the
        // state broadcast. A fixed 5s window keeps the value smooth
        // even at X4 because no real combat pause is that long.
        const windowMs = BEST_WINDOW_BASE_MS;
        windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= windowMs);
        const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
        setCurWindow(cur);
        setBestWindow((prev) => Math.max(prev, cur));
    }, [isMultiHumanParty, iAmLeader]);

    // Combat tick.
    // 2026-05-15 v6 spec ("WIDOK JEST JEDEN I NA WIDOKU KAZDY WIDZI
    // TO SAMO"): the tick runs on EVERY client so each player's own
    // DOTs, summons, and per-skill cooldowns drain locally — but
    // pushDamage (the shared session counter) is a no-op on members
    // and only the LEADER's trainer-state broadcast can mutate the
    // counter. Every damage event the member emits is broadcast and
    // applied to the leader's local counter via the subscriber, then
    // re-published as part of leader's state snapshot. The trainer-
    // hits-back tick + the auto-ally simulation loop have their own
    // gates further down (leader-only / bots-only) so each piece of
    // SHARED state stays leader-authoritative without ripping the
    // entire tick out of member clients.
    useEffect(() => {
        if (!character) return;
        const interval = setInterval(() => {
            tickRef.current += 1;
            const tick = tickRef.current;

            // 2026-05 v6: Cleric Błogosławieństwo (heal_party_dot) — fire
            // ONE regen pulse per in-game second so the player sees a
            // discrete "+X HP" float on every ally each tick (was a
            // smeared continuous regen with floats only every ~2s).
            // Accumulator gets `intervalMs × speedMult` per pass; when
            // it crosses 1000ms (= 1 game-second) we pop one pulse.
            const partyHealPct = useBuffStore.getState().getPartyHealDotPctPerSec();
            if (partyHealPct > 0 && character) {
                const intervalMs = Math.max(100, 500 / speedMult);
                partyHealAccumRef.current += intervalMs * Math.max(1, speedMult);
                const pulseSkillId = useBuffStore.getState().getPartyHealDotSkillId();
                while (partyHealAccumRef.current >= 1000) {
                    partyHealAccumRef.current -= 1000;
                    // Player slot 0 — heal sandbox HP, push float, and
                    // play the spell's animation overlay so the player
                    // sees the cast art on every ally each second
                    // (Błogosławieństwo -> :folded-hands: holy glow).
                    const playerHeal = Math.max(1, Math.floor(character.max_hp * (partyHealPct / 100)));
                    const before = sandboxHpRef.current;
                    sandboxHpRef.current = Math.min(character.max_hp, before + playerHeal);
                    setSandboxHp(sandboxHpRef.current);
                    const playerActual = sandboxHpRef.current - before;
                    const playerCapped = playerActual < playerHeal ? ' (MAX)' : '';
                    fx.pushAllyFloat(mySlot,playerHeal, 'heal', {
                        icon: 'green-heart',
                        label: playerCapped ? `+${playerHeal}${playerCapped}` : undefined,
                    });
                    if (pulseSkillId) fx.triggerAllySkillAnim(mySlot,pulseSkillId);
                    // Bot slots 1+ — same per-second pulse + animation
                    // on every alive ally. Two HP scales here:
                    //   - botHpMap is the cosmetic 0..100 bar value
                    //     (bots show a static 100-max bar in Trainer).
                    //   - The float shows the REAL heal value computed
                    //     from the bot's actual party maxHp (lvl 1000
                    //     Knight has ~20000 HP -> +1000 per pulse at 5%).
                    // Without the second scale the float read "+5 HP"
                    // even though Blessing healed for 5% of real maxHp.
                    for (let i = 0; i < otherPartyMembers.length; i++) {
                        const m = otherPartyMembers[i];
                        const cur = botHpMap[m.id] ?? 100;
                        // Skip dead allies — Błogosławieństwo's regen
                        // is a buff, only revive_party can bring them
                        // back. Dead = in deadAllies OR HP=0.
                        if (deadAllies.has(m.id) || cur <= 0) continue;
                        const realMaxHp = m.maxHp || 100;
                        const realHeal = Math.max(1, Math.floor(realMaxHp * (partyHealPct / 100)));
                        // Bar fills at the same % rate as real heal so
                        // the visual matches the float pace.
                        const barHeal = Math.max(1, Math.floor(100 * (partyHealPct / 100)));
                        const newHp = Math.min(100, cur + barHeal);
                        if (newHp !== cur) {
                            setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                        }
                        const botCapped = cur >= 100 ? ' (MAX)' : '';
                        const allySlot = slotOfMember(m.id);
                        fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                            icon: 'green-heart',
                            label: botCapped ? `+${realHeal}${botCapped}` : undefined,
                        });
                        if (pulseSkillId) fx.triggerAllySkillAnim(allySlot, pulseSkillId);
                    }
                }
            } else if (partyHealAccumRef.current !== 0) {
                // Buff expired / never had one -> reset so the next cast
                // doesn't fire a stale partial pulse on first tick.
                partyHealAccumRef.current = 0;
            }

            // Drain skill cooldowns (ms-based) so the action-bar sweep
            // visually counts down. The displayed value is the full
            // nominal cooldown (e.g. 8000ms for an 8s spell) — the
            // PER-TICK drain is constant 500ms, regardless of speed, so
            // at x4 (125ms tick) the bar empties in 2 real seconds even
            // though it started at 8s; at x2 (250ms tick) it empties in
            // 4 real seconds. Matches how the hunt-engine ticks.
            // Earlier we shrank the initial value to `cooldown / m` and
            // drained slowly — the bar started at 2s and ticked normally
            // (looks broken; the player sees "2s" instead of the real
            // skill CD).
            const drainPerTick = 500;
            setSkillCooldownsMs((prev) => {
                const keys = Object.keys(prev);
                if (keys.length === 0) return prev;
                const next: Record<string, number> = {};
                let changed = false;
                for (const id of keys) {
                    const v = Math.max(0, prev[id] - drainPerTick);
                    if (v > 0) next[id] = v;
                    if (v !== prev[id]) changed = true;
                }
                return changed ? next : prev;
            });

            // Basic attack every 2 ticks. Each swing rolls fresh damage
            // (weapon min/max + variance) so the float stack reads as
            // a real DPS distribution instead of N copies of a single
            // number.
            // 2026-05-15 v7 spec ("Usmiercilem sojusznika ... nie
            // powinien moc otrzymywac obrazen oraz atakowac ani
            // spellem ani atakiem nawet jak ma wlaczony auto attack"):
            // if the local player is in `deadAllies` (sandbox-killed
            // by the leader via Uśmierć), block their own auto-basic
            // swings + auto-skill casts. The card stays at 100% HP/MP
            // visually (sandbox dummy stays invincible) but no new
            // hits land on the dummy from this character until they
            // get revived. Manual skill clicks are blocked by the
            // same guard inside doManualSkill below.
            if (autoBasic && tick % 2 === 0 && !deadAllies.has(character.id)) {
                // 2026-05 v6: Knight/Rogue dual-wield. Two separate
                // strikes at 60% damage each, ~150ms apart so the
                // per-hand floats stack as distinct cuts. Each hit
                // independently consumes one "next basic" buff
                // charge (crit_next / dmg_amp_next / lifesteal /
                // nextAllyHeal) so both swings can independently
                // proc the buff. Matches the user's "5 attacks = 5
                // procs" expectation for Boski Filar in dual-wield.
                const charCrit = (character.crit_chance ?? 0.05);
                const dual = isDualWieldRef.current;
                const fireStrike = (hand: 'left' | 'right' | undefined, useOffHand: boolean, dmgPercent: number) => {
                    const playerStatus = ensureStatus(effectsRef.current, TRAINER_PLAYER_FX_ID);
                    const mods = consumeCasterBasicHitMods(playerStatus);
                    syncCasterChargeConsume(mods.consumed);
                    let dmg = rollBasicHit(dmgPercent, useOffHand);
                    const isCrit = mods.forceCrit ? true : Math.random() < (charCrit + mods.extraCritChance);
                    if (isCrit) dmg = Math.floor(dmg * 2);
                    if (mods.dmgMult !== 1) dmg = Math.max(1, Math.floor(dmg * mods.dmgMult));
                    // 2026-05 v7: Heroiczna Ballada (party_def_pen) — in
                    // Trainer (synthetic dummy, no real defence stat) we
                    // mirror the def-pen as a flat damage bonus so the
                    // buff is visible. Real-combat views apply def_pen
                    // to the dummy's defence stat in the damage roll.
                    if (playerStatus.defPenMs > 0 && playerStatus.defPenPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + playerStatus.defPenPct / 100)));
                    }
                    // 2026-05 v7: Pieśń Wszechświata
                    // (party_instant_kill_chance_next:5:5) — each charge
                    // gives this swing a 5% chance to one-shot. Counter
                    // decreases per attack (hit or miss) until the queue
                    // empties. Also drains the BuffStore charge so the
                    // BuffBar "×N" pill ticks down visibly.
                    let universeIK = false;
                    if (playerStatus.nextAllyInstantKillPct.length > 0) {
                        const top = playerStatus.nextAllyInstantKillPct[0];
                        if (top.count > 0) {
                            if (Math.random() * 100 < top.pct) universeIK = true;
                            top.count -= 1;
                            if (top.count <= 0) playerStatus.nextAllyInstantKillPct.shift();
                            useBuffStore.getState().consumeBuffCharge('skill_charge_party_instant_kill_chance_next');
                        }
                    }
                    if (universeIK) {
                        // Crit-style DEATH ATTACK label on the dummy +
                        // a system log line so the player knows the
                        // 5% rolled (Trainer dummies are invincible
                        // so we just float the marker).
                        fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        addLog(`:skull: Pieśń Wszechświata: DEATH ATTACK!`);
                    }
                    // 2026-05 v6: Necromancer Klątwa Śmierci (mark_amp)
                    // — first damaging hit on the marked target
                    // consumes the charge and gets ×6 damage. Only
                    // the player's own swing consumes the charge;
                    // summons fire flat damage in the staggered
                    // setTimeout block below (without re-consuming).
                    const dummySt = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampBasic = consumeTargetMarkAmp(dummySt);
                    if (ampBasic.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampBasic.mult));
                        addLog(`:skull-and-crossbones: Klątwa Śmierci! ×${ampBasic.mult} dmg`);
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, dmg, 'basic', { isCrit, icon: hand ? 'dagger' : undefined });
                    setDummyAttackingClass(`attack-${character.class}`);
                    window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                    const handPrefix = hand === 'left' ? '[Lewa] ' : hand === 'right' ? '[Prawa] ' : '';
                    addLog(isCrit ? `:high-voltage: KRYTYK! ${handPrefix}${dmg} dmg` : `:crossed-swords: ${handPrefix}${dmg} dmg`);
                    // 2026-05-15 v3 spec ("Dlaczego widze 2 ataki skoro
                    // tylko sojusznik wlaczyl atak w potwora a lider
                    // nie ... Dlaczego na ekranie wyzej nie widze
                    // ataku sojusznika skoro wlaczyl go"): broadcast
                    // every local basic hit so other clients render
                    // the float + class swing on OUR ally slot. The
                    // ally-simulation loop below is gated to solo /
                    // bots-only parties so the leader's view doesn't
                    // synthesize fake bot attacks for members — each
                    // member's own client owns their attacks now.
                    if (isMultiHumanParty) {
                        const dmgCap = dmg;
                        const isCritCap = isCrit;
                        const classCap = character.class;
                        const charIdCap = character.id;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: 0,
                                damage: dmgCap,
                                isCrit: isCritCap,
                                kind: 'basic',
                                icon: hand ? 'dagger' : undefined,
                            });
                        }).catch(() => { /* offline */ });
                    }
                    // Per-hit lifesteal (Boski Filar) — heals
                    // attacker for pct% of THIS swing's dmg.
                    if (mods.lifestealPct > 0 && dmg > 0) {
                        const heal = Math.max(1, Math.floor(dmg * (mods.lifestealPct / 100)));
                        const before = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                        setSandboxHp(sandboxHpRef.current);
                        const actual = sandboxHpRef.current - before;
                        const tag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot,heal, 'heal', {
                            icon: 'drop-of-blood',
                            label: tag ? `+${heal}${tag}` : undefined,
                        });
                        addLog(`:drop-of-blood: Lifesteal: ${handPrefix}+${heal} HP${tag}`);
                    }
                    // Per-hit next_ally_heal (Sąd Boży) — heals only
                    // the caster for pct% of their max HP.
                    if (mods.nextAllyHealPct > 0) {
                        const heal = Math.max(1, Math.floor(character.max_hp * (mods.nextAllyHealPct / 100)));
                        const before = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                        setSandboxHp(sandboxHpRef.current);
                        const actual = sandboxHpRef.current - before;
                        const tag = actual < heal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot,heal, 'heal', {
                            icon: 'sparkles',
                            label: tag ? `+${heal}${tag}` : undefined,
                        });
                        addLog(`:sparkles: Sąd Boży heal: ${handPrefix}+${heal} HP${tag}`);
                    }
                    return dmg;
                };
                if (dual) {
                    fireStrike('left', false, 0.6);
                    // Off-hand swing 150ms later — separate float +
                    // animation so the player sees TWO cuts, not a
                    // single combined number.
                    window.setTimeout(() => fireStrike('right', true, 0.6), 150);
                } else {
                    fireStrike(undefined, false, 1.0);
                }
                // 2026-05 v6: Necromancer summons swing INDEPENDENTLY
                // alongside the necro's basic. Each summon gets:
                //   - own staggered swing (~120 ms apart so the
                //     dummy card flashes one-per-summon, not a single
                //     merged shake)
                //   - own type-specific float on the dummy (skeleton
                //     :skull-and-crossbones: / ghost :ghost: / demon :smiling-face-with-horns: / lich :crown:) so the
                //     player can read who hit for what
                //   - own damage = floor(necroAttack × dmgMult)
                //     (skeleton 25% / ghost 50% / demon 120% / lich
                //     200%)
                // Summons don't consume mark_amp (only the player's
                // first hit does — see fireStrike). They're displayed
                // in the same priority order as the avatar swap, so
                // the oldest skeleton swings first, lich last.
                if (character.class === 'Necromancer' && necroSummonsForPlayer.length > 0) {
                    const SUMMON_TYPE_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
                    const SUMMON_ICON: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
                        skeleton: 'skull-and-crossbones', ghost: 'ghost', demon: 'smiling-face-with-horns', lich: 'crown',
                    };
                    const sortedSummons = [...necroSummonsForPlayer].sort(
                        (a, b) => SUMMON_TYPE_RANK[a.type] - SUMMON_TYPE_RANK[b.type],
                    );
                    sortedSummons.forEach((sm, idx) => {
                        // First summon swings ~80 ms after the player
                        // (lets the player's own float pop first); each
                        // subsequent summon adds another 100 ms.
                        const delay = 80 + idx * 100;
                        window.setTimeout(() => {
                            let summonDmg = Math.max(1, Math.floor(myAttack * sm.dmgMult));
                            // 2026-05 v7: summons consume Klątwa (count
                            // mark) AND get Kraina Śmierci (duration mark
                            // ×N) the same as the necro's swing.
                            const dummyStSum = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                            const ampSum = consumeTargetMarkAmp(dummyStSum);
                            if (ampSum.mult !== 1) {
                                summonDmg = Math.max(1, Math.floor(summonDmg * ampSum.mult));
                            }
                            pushDamage(summonDmg);
                            setDummyHitPulse((p) => p + 1);
                            fx.pushEnemyFloat(0, summonDmg, 'ally-basic', {
                                icon: SUMMON_ICON[sm.type],
                            });
                            // Brief attack-flash on the dummy so the
                            // player sees the summon "land" the hit.
                            setDummyAttackingClass('attack-Necromancer');
                            window.setTimeout(() => setDummyAttackingClass(null), ATTACK_FLASH_MS);
                        }, delay);
                    });
                }
            }

            // Auto-skill — fires every tick that a skill comes off
            // cooldown. Each individual skill is gated by its own
            // per-skill timer (`cooldownsRef`), so a fast-CD spell goes
            // off often and a slow-CD ultimate stays banked. Earlier
            // this gated the WHOLE check to `tick % 16 === 0` (one cast
            // per 8 seconds at x1) which made auto-skill feel broken
            // when several short-CD skills should have been cycling.
            // 2026-05-15 v7: same death-gate as basic — sandbox-killed
            // self can't auto-skill until the leader revives them.
            if (autoSkill && !deadAllies.has(character.id)) {
                const slots = activeSkillSlots ?? [];
                // 2026-05 v6: include pure-buff skills too — auto-cast
                // should fire Orle Oko / Tarcza Many / Bomba Dymna so the
                // sandbox cycles them automatically. Old filter dropped
                // any skill with damage===0 which silently buried buffs.
                const equippedSkills = getClassActiveSkills(character.class)
                    .filter((s) => slots.includes(s.id) && s.unlockLevel <= character.level);
                for (const ready of equippedSkills) {
                    // No-CD toggle (sandbox) — bypasses per-skill cooldown
                    // so auto-skill mode chains every cast back-to-back
                    // for stress-testing burst combos.
                    if (!noCooldowns && (cooldownsRef.current[ready.id] ?? 0) > tick) continue;
                    // 2026-05 v7: Apokalipsa Śmierci synchronous self-cost.
                    if ((ready.effect ?? '').includes('death_apocalypse')) {
                        const effA = getEffectiveChar(character);
                        const effMaxA = effA?.max_hp ?? character.max_hp;
                        const hpPct = sandboxHpRef.current / Math.max(1, effMaxA);
                        if (hpPct < 0.05) continue;
                        let newHpAfter: number;
                        if (hpPct > 0.20) {
                            newHpAfter = Math.max(1, sandboxHpRef.current - Math.floor(effMaxA * 0.20));
                        } else {
                            newHpAfter = Math.max(1, Math.floor(effMaxA * 0.03));
                        }
                        const lost = sandboxHpRef.current - newHpAfter;
                        if (lost > 0) {
                            apokalipsaSuppressUntilRef.current = Number.MAX_SAFE_INTEGER;
                            sandboxHpRef.current = newHpAfter;
                            setSandboxHp(newHpAfter);
                            useCharacterStore.getState().updateCharacter({ hp: newHpAfter });
                            fx.pushAllyFloat(mySlot,lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                            addLog(`:broken-heart: Apokalipsa: -${lost} HP`);
                        }
                    }
                    if (!noCooldowns) {
                        cooldownsRef.current[ready.id] = tick + Math.ceil(ready.cooldown / 500);
                        setSkillCooldownsMs((prev) => ({ ...prev, [ready.id]: ready.cooldown }));
                    }
                    const isDamageHitAuto = ready.damage > 0;
                    const targetsEnemyAuto = isDamageHitAuto || skillTargetsEnemy(ready.effect ?? null);
                    const isAoeAuto = (ready.effect ?? '').split(';').some((a) => a.trim().toLowerCase().startsWith('aoe'));
                    // v2 effect routing — registers DOT/stun/mark on dummy
                    // status + crit_buff/dmg_amp_next on player status.
                    // Include every party ally so party_lifesteal_next /
                    // next_ally_heal stack onto each bot's queue too.
                    // Include EVERY party member (alive + dead) in the
                    // cast's allyIds. Dead bots' status queues stay
                    // dormant (they can't act) but Holy Apocalypse
                    // also revives + grants party_immortal in one
                    // cast — including dead in allyIds means the
                    // immortalMs lands on their status, so once
                    // revive_party clears them they're already
                    // protected. The "dead allies can't be buffed"
                    // rule is enforced VISUALLY (no anim on dead
                    // slots) — the underlying buff sits on the v2
                    // status, harmlessly waiting for revive.
                    const partyAllyIdsAuto = partyMembers
                        .filter((m) => m.id !== character.id)
                        .slice(0, 3)
                        .map((m) => `trainer_ally_${m.id}`);
                    const allyIdsAuto = [TRAINER_PLAYER_FX_ID, ...partyAllyIdsAuto];
                    const applyAuto = effectsCastSkill({
                        session: effectsRef.current,
                        casterId: TRAINER_PLAYER_FX_ID,
                        targetId: TRAINER_DUMMY_FX_ID(0),
                        // Use the slider-driven dummy HP % so
                        // `execute_below:25` (Egzekucja) actually procs
                        // its instant-kill branch when the dummy is
                        // "below threshold" — even though the dummy
                        // never really loses HP.
                        targetHpPct: dummyHpPct,
                        effect: ready.effect ?? null,
                        allyIds: allyIdsAuto,
                        enemyIds: Array.from({ length: trainerCount }, (_, i) => TRAINER_DUMMY_FX_ID(i)),
                    });
                    const defPenAuto = applyAuto.defPenPct ?? 0;
                    let dmgAuto = isDamageHitAuto ? Math.floor(myAttack * ready.damage * (1 + defPenAuto / 100)) : 0;
                    // Klątwa Śmierci amp on auto-skill spell cast.
                    if (isDamageHitAuto && dmgAuto > 0) {
                        const dummyStAuto = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                        const ampAutoSpell = consumeTargetMarkAmp(dummyStAuto);
                        if (ampAutoSpell.mult !== 1) {
                            dmgAuto = Math.max(1, Math.floor(dmgAuto * ampAutoSpell.mult));
                            addLog(`:skull-and-crossbones: Klątwa Śmierci! ${ready.id} ×${ampAutoSpell.mult} dmg`);
                        }
                    }
                    // Track total dmg dealt (primary + splashes) so
                    // heal_self_pct_dmg sums across the AOE for Żniwa.
                    let totalDmgAuto = 0;
                    if (!targetsEnemyAuto) {
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        // 2026-05-15 v14: match the receiver's BUFF
                        // float on caster slot so the caster sees the
                        // same :sparkles: BUFF label every ally sees.
                        fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
                        addLog(`:sparkles: ${ready.id}: BUFF`);
                        // 2026-05-15 v5 spec ("Tak samo jak uzywam
                        // buffa to widze tylko na swoim ekranie ze go
                        // uzylem i nigdzie wiecej"): broadcast the
                        // self-buff cast so other clients fire the
                        // ally-skill animation on the caster's slot
                        // AND the receiver's `applySkillBuff` adds
                        // the party-filtered atoms to their BuffBar.
                        if (isMultiHumanParty && character) {
                            const idCap = ready.id;
                            const classCap = character.class;
                            const charIdCap = character.id;
                            void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                usePartyCombatSyncStore.getState().publishTrainerAttack({
                                    attackerId: charIdCap,
                                    attackerClass: classCap,
                                    dummyIdx: 0,
                                    damage: 0,
                                    kind: 'ally-spell',
                                    icon: getSkillIcon(idCap),
                                    skillId: idCap,
                                    label: 'BUFF',
                                });
                            }).catch(() => { /* offline */ });
                        }
                    } else {
                        fx.triggerEnemySkillAnim(0, ready.id);
                        // 2026-05-15 v9 spec ("Dlaczego jak sojusznik
                        // uzywa spella widze zawsze animacje na moim
                        // ekranie na nim i na potworze ... A jak ja
                        // uzywam to sojusznik widzi tylko na
                        // potworze? Ujednolic to zeby bylo i na mnie
                        // i na potworze"): also fire the ally-slot
                        // animation on the caster's own card for
                        // damage spells so the LOCAL view matches
                        // what receivers already render (the
                        // receiver subscriber unconditionally fires
                        // triggerAllySkillAnim on the caster's slot
                        // regardless of buff/damage kind). Without
                        // this every cast looked asymmetric — others
                        // saw it on the caster, the caster only saw
                        // the dummy.
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        setDummyHitPulse((p) => p + 1);
                        // 2026-05 v7: AOE pure-debuff auto-cast (e.g.
                        // Pieśń Syren) — splash anim on every dummy.
                        if (isAoeAuto && !isDamageHitAuto) {
                            for (let i = 1; i < trainerCount; i++) {
                                fx.triggerEnemySkillAnim(i, ready.id);
                            }
                        }
                        if (isDamageHitAuto) {
                            pushDamage(dmgAuto);
                            totalDmgAuto += dmgAuto;
                            fx.pushEnemyFloat(0, dmgAuto, 'spell', { icon: getSkillIcon(ready.id) });
                            // 2026-05-15 v3: broadcast the auto-skill
                            // hit so every other client renders the
                            // same float + themed overlay on their
                            // dummy. Reuses the trainer-attack channel
                            // pipeline (skillId triggers the themed
                            // anim).
                            if (isMultiHumanParty && character) {
                                const dmgCap = dmgAuto;
                                const idCap = ready.id;
                                const classCap = character.class;
                                const charIdCap = character.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                                        attackerId: charIdCap,
                                        attackerClass: classCap,
                                        dummyIdx: 0,
                                        damage: dmgCap,
                                        kind: 'spell',
                                        icon: getSkillIcon(idCap),
                                        skillId: idCap,
                                    });
                                }).catch(() => { /* offline */ });
                            }
                            if (isAoeAuto) {
                                const splashDmgAutoT = Math.max(1, Math.floor(dmgAuto * 0.75));
                                for (let i = 1; i < trainerCount; i++) {
                                    // 2026-05 v7: each splash consumes its
                                    // own markAmp (Kraina ×N applies on
                                    // every dummy in the wave).
                                    let splashFinalAuto = splashDmgAutoT;
                                    const splashStAutoT = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(i));
                                    const ampSplashAutoT = consumeTargetMarkAmp(splashStAutoT);
                                    if (ampSplashAutoT.mult !== 1) {
                                        splashFinalAuto = Math.max(1, Math.floor(splashFinalAuto * ampSplashAutoT.mult));
                                    }
                                    fx.triggerEnemySkillAnim(i, ready.id);
                                    fx.pushEnemyFloat(i, splashFinalAuto, 'spell', { icon: getSkillIcon(ready.id) });
                                    pushDamage(splashFinalAuto);
                                    totalDmgAuto += splashFinalAuto;
                                    // 2026-05-15 v5 spec ("Jak uzywam
                                    // spella AOE to mi pokazuje sie
                                    // dobrze ze zabiera DMG wszystkim
                                    // potworom ale sojusznikom juz
                                    // nie"): broadcast each splash so
                                    // every client renders the float
                                    // + animation on the matching
                                    // dummy.
                                    if (isMultiHumanParty && character) {
                                        const dmgSplashCap = splashFinalAuto;
                                        const idxCap = i;
                                        const idCap = ready.id;
                                        const classCap = character.class;
                                        const charIdCap = character.id;
                                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                                attackerId: charIdCap,
                                                attackerClass: classCap,
                                                dummyIdx: idxCap,
                                                damage: dmgSplashCap,
                                                kind: 'spell',
                                                icon: getSkillIcon(idCap),
                                                skillId: idCap,
                                            });
                                        }).catch(() => { /* offline */ });
                                    }
                                }
                            }
                            const tags = [
                                isAoeAuto ? 'AOE' : '',
                                defPenAuto > 0 ? `ignoruje ${defPenAuto}% DEF` : '',
                            ].filter(Boolean).join(', ');
                            addLog(`:sparkles: ${ready.id}: ${dmgAuto} dmg${tags ? ` (${tags})` : ''}`);
                        } else {
                            addLog(`:sparkles: ${ready.id}: DEBUFF`);
                        }
                        // Żniwa Dusz on auto-skill — heal 50% of TOTAL
                        // damage dealt this cast (primary + splashes).
                        if (applyAuto.healCasterPctOfDmg > 0 && totalDmgAuto > 0 && character) {
                            const heal = Math.floor(totalDmgAuto * (applyAuto.healCasterPctOfDmg / 100));
                            if (heal > 0) {
                                const before = sandboxHpRef.current;
                                sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                                setSandboxHp(sandboxHpRef.current);
                                fx.pushAllyFloat(mySlot,heal, 'heal', { icon: 'sparkles', label: `+${heal}` });
                                addLog(`:sparkles: ${ready.id}: +${heal} HP`);
                            }
                        }
                        // Stun/paralyze label — per-target. AOE rolls
                        // independently per dummy; label appears only on
                        // the dummies that actually got stunned.
                        if (isAoeAuto) {
                            for (const idx of applyAuto.aoeStunIdxs) {
                                if (idx < trainerCount) {
                                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                                }
                            }
                            for (const idx of applyAuto.aoeParalyzeIdxs) {
                                if (idx < trainerCount) {
                                    fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                                }
                            }
                        } else if (applyAuto.stunApplied) {
                            fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                        } else if (applyAuto.paralyzeApplied) {
                            fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                        }
                    }
                    // Multistrike (Wielostrzał auto)
                    if ((applyAuto.multistrike ?? 0) > 0) {
                        const extra = Math.max(0, Math.floor(applyAuto.multistrike));
                        for (let n = 0; n < extra; n++) {
                            window.setTimeout(() => {
                                const followup = rollBasicHit();
                                pushDamage(followup);
                                setDummyHitPulse((p) => p + 1);
                                fx.pushEnemyFloat(0, followup, 'basic');
                                addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`);
                            }, 120 * (n + 1));
                        }
                    }
                    // 2026-05 v6: party-buff side effects from auto-skill
                    // casts. Without this block, an auto-cast Holy
                    // Apocalypse / Wieża Bogów / Aura Wskrzeszenia
                    // applied stun/dmg but never the revive / immortal /
                    // party-heal payload — same gap the manual cast
                    // already covers below.
                    const autoAllies = partyMembers
                        .filter((m) => m.id !== character.id)
                        .slice(0, 3);
                    if (applyAuto.partyImmortalMs > 0) {
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                        for (let i = 0; i < autoAllies.length; i++) {
                            const m = autoAllies[i];
                            const cur = botHpMap[m.id] ?? 100;
                            if (deadAllies.has(m.id) || cur <= 0) continue;
                            const allySlot = slotOfMember(m.id);
                            fx.triggerAllySkillAnim(allySlot, ready.id);
                            fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
                        }
                    }
                    // 2026-05 v7: Bard party-buff visualization — auto cast.
                    {
                        const autoBuffAtoms = (ready.effect ?? '').split(';').map((a) => a.trim().toLowerCase());
                        const hasPartyBuffAuto = autoBuffAtoms.some((a) =>
                            a.startsWith('party_attack_up') ||
                            a.startsWith('party_defense_up') ||
                            a.startsWith('party_as_up') ||
                            a.startsWith('party_crit_up') ||
                            a.startsWith('party_def_pen') ||
                            a.startsWith('party_lifesteal_next'),
                        );
                        if (hasPartyBuffAuto) {
                            fx.triggerAllySkillAnim(mySlot, ready.id);
                            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                            for (let i = 0; i < autoAllies.length; i++) {
                                const m = autoAllies[i];
                                const cur = botHpMap[m.id] ?? 100;
                                if (deadAllies.has(m.id) || cur <= 0) continue;
                                const allySlot = slotOfMember(m.id);
                                fx.triggerAllySkillAnim(allySlot, ready.id);
                                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
                            }
                        }
                        const hasEnemyDebuffAuto = autoBuffAtoms.some((a) => a.startsWith('enemy_atk_down') || a.startsWith('enemy_no_heal'));
                        if (hasEnemyDebuffAuto) {
                            for (let dIdx = 0; dIdx < trainerCount; dIdx++) {
                                fx.pushEnemyFloat(dIdx, 0, 'spell', { icon: 'sleeping-face', label: 'DEBUFF' });
                            }
                        }
                    }
                    if (applyAuto.reviveDeadAllies) {
                        // Dead = in sandbox set OR HP=0 in the bar.
                        const reviveIds = new Set<string>();
                        const reviveNames: string[] = [];
                        for (const m of autoAllies) {
                            const inSet = deadAllies.has(m.id);
                            const hpZero = (botHpMap[m.id] ?? 100) <= 0;
                            if (inSet || hpZero) {
                                reviveIds.add(m.id);
                                reviveNames.push(m.name);
                            }
                        }
                        if (reviveNames.length > 0) {
                            setDeadAllies((prev) => {
                                const nx = new Set(prev);
                                for (const id of reviveIds) nx.delete(id);
                                return nx;
                            });
                            setBotHpMap((prev) => {
                                const next = { ...prev };
                                for (const id of reviveIds) next[id] = 100;
                                return next;
                            });
                            for (let i = 0; i < autoAllies.length; i++) {
                                const m = autoAllies[i];
                                if (reviveIds.has(m.id)) {
                                    const allySlot = slotOfMember(m.id);
                                    fx.pushAllyFloat(allySlot, 100, 'heal', { icon: 'sparkles', label: '+REZ' });
                                    fx.triggerAllySkillAnim(allySlot, ready.id);
                                }
                            }
                            addLog(`:sparkles: ${ready.id} -> wskrzeszono: ${reviveNames.join(', ')}`);
                        }
                    }
                    if (applyAuto.healPartyPctInstant > 0 && character) {
                        const playerHeal = Math.max(1, Math.floor(character.max_hp * (applyAuto.healPartyPctInstant / 100)));
                        const beforePlayer = sandboxHpRef.current;
                        sandboxHpRef.current = Math.min(character.max_hp, beforePlayer + playerHeal);
                        setSandboxHp(sandboxHpRef.current);
                        const playerActual = sandboxHpRef.current - beforePlayer;
                        const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
                        fx.pushAllyFloat(mySlot, playerHeal, 'heal', {
                            icon: 'sparkles',
                            label: playerTag ? `+${playerHeal}${playerTag}` : undefined,
                        });
                        fx.triggerAllySkillAnim(mySlot, ready.id);
                        for (let i = 0; i < autoAllies.length; i++) {
                            const m = autoAllies[i];
                            const cur = botHpMap[m.id] ?? 100;
                            if (deadAllies.has(m.id) || cur <= 0) continue;
                            const realMaxHp = m.maxHp || 100;
                            const realHeal = Math.max(1, Math.floor(realMaxHp * (applyAuto.healPartyPctInstant / 100)));
                            const barHeal = Math.max(1, Math.floor(100 * (applyAuto.healPartyPctInstant / 100)));
                            const newHp = Math.min(100, cur + barHeal);
                            if (newHp !== cur) setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                            const tag = cur >= 100 ? ' (MAX)' : '';
                            const allySlot = slotOfMember(m.id);
                            fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                                icon: 'sparkles',
                                label: tag ? `+${realHeal}${tag}` : undefined,
                            });
                            fx.triggerAllySkillAnim(allySlot, ready.id);
                        }
                        // Necro summons share the heal too.
                        if (character.class === 'Necromancer') {
                            useNecroSummonStore.getState().healAllPct(character.id, applyAuto.healPartyPctInstant);
                        }
                    }
                    const sd = getSkillDef(ready.id);
                    if (sd) applySkillBuff(ready.id, sd, speedMult);
                    // Necromancer summon spawn from auto-skill path —
                    // mirror of the manual cast block below. Without
                    // this, necro auto-skill rotation never spawned
                    // skeletons / ghosts / etc.
                    if (applyAuto.summons.length > 0 && character?.class === 'Necromancer') {
                        const store = useNecroSummonStore.getState();
                        for (const sm of applyAuto.summons) {
                            const spawned = store.spawn(character.id, sm.type, sm.count, myAttack, character.max_hp, character.max_mp);
                            if (spawned > 0) {
                                addLog(`:skull: Przywołano ${spawned}× ${sm.type}`);
                                fx.triggerAllySkillAnim(mySlot,ready.id);
                                // 2026-05 v7: per-type spawn animation (2s)
                                fx.triggerAllySummonSpawn(mySlot,sm.type);
                                fx.pushAllyFloat(mySlot,spawned, 'heal', {
                                    icon: 'skull',
                                    label: `+${spawned}× ${sm.type.toUpperCase()}`,
                                });
                            }
                        }
                    }
                    // 2026-05 v7: Apokalipsa Śmierci — target damage only.
                    // Self-cost handled at top of auto-skill loop.
                    if (applyAuto.deathApocalypse) {
                        const dummyPseudoMaxHp = Math.max(100, myAttack * 4);
                        const apocDmg = Math.max(1, Math.floor(dummyPseudoMaxHp * (applyAuto.deathApocalypseTargetMaxHpPct / 100)));
                        fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
                        pushDamage(apocDmg);
                        addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`);
                    }
                    // Fire one skill per tick — staggers casts so the
                    // float stack stays readable instead of N spells
                    // landing in the same animation frame.
                    break;
                }
            }

            // Party-member combat — every non-self ally swings + casts
            // alongside the player. Damage is synthetic (level-scaled)
            // since IPartyMember doesn't carry full combat stats. Each
            // member has their own per-skill cooldown map so fast-CD
            // spells fire at their own cadence, and the float stack on
            // the dummy uses 'ally-basic' / 'ally-spell' tints so the
            // player can tell their hits apart from the party's hits.
            //
            // 2026-05-15 v3 spec ("Dlaczego widze 2 ataki skoro tylko
            // sojusznik wlaczyl atak w potwora a lider nie"): when at
            // least one OTHER human is in the party, EACH client owns
            // their own attacks and broadcasts them. Synthesizing the
            // other humans' attacks locally would produce phantom
            // swings (leader sees member auto-attacking even when the
            // member turned it OFF). So skip the simulation entirely
            // for multi-human parties — incoming attacks render via
            // the trainer-attack subscriber below. Solo + bots-only
            // parties keep the existing local simulation (no other
            // client to broadcast on their behalf).
            const allies = isMultiHumanParty
                ? partyMembers.filter((m) => m.id !== character.id && m.isBot).slice(0, 3)
                : partyMembers.filter((m) => m.id !== character.id).slice(0, 3);
            // 2026-05 v6: per-class AS so allies don't all swing on the
            // same tick (Mage 2.0 -> every 3 ticks, Knight 1.5 -> every 4,
            // Rogue/Archer 2.5 -> every 2). Plus per-ally offset (idx %)
            // so two members of the same class still desync.
            const CLASS_TICK_PERIOD: Record<string, number> = {
                Knight: 4, Mage: 3, Cleric: 3, Archer: 2,
                Rogue: 2, Necromancer: 4, Bard: 3,
            };
            for (let allyIdx = 0; allyIdx < allies.length; allyIdx++) {
                const ally = allies[allyIdx];
                // Dead allies are inert — no basic, no skill, no XP/drop
                // from anything. Cover both kill paths: sandbox picker
                // (deadAllies) AND HP=0 from dummy attacks. Only
                // revive_party can bring them back.
                if (deadAllies.has(ally.id)) continue;
                if ((botHpMap[ally.id] ?? 100) <= 0) continue;
                const allyAttack = Math.max(5, Math.floor(ally.level * 4));
                const basePeriod = CLASS_TICK_PERIOD[ally.class] ?? 3;
                // 2026-05 v7: Ballada Bohaterów (party_as_up:1.5:12000) —
                // pull the ally's AS multiplier from their v2 status so
                // their swing cadence speeds up while the buff is live.
                // Period scales inversely (higher AS -> fewer ticks
                // between swings). Floored to 1 so x1.5 still works
                // even on Rogue/Archer (basePeriod=2 -> 1).
                const allyFxIdSwingCadence = `trainer_ally_${ally.id}`;
                const allyStCadence = effectsRef.current.statuses.get(allyFxIdSwingCadence);
                const asMult = (allyStCadence && allyStCadence.asMultMs > 0 && allyStCadence.asMult > 1)
                    ? allyStCadence.asMult : 1;
                const period = Math.max(1, Math.floor(basePeriod / asMult));
                const offset = allyIdx; // desync same-class members
                // Ally basic — fires only when autoBasic is ON, on the
                // class-specific cadence so each member swings at their
                // own AS instead of all on the same tick.
                if (autoBasic && (tick + offset) % period === 0) {
                    const variance = Math.floor(allyAttack * 0.2);
                    let dmg = Math.max(1, allyAttack - variance + Math.floor(Math.random() * (variance * 2 + 1)));
                    // 2026-05 v7: apply Hymn Bitewny (party_attack_up) +
                    // War Song (party_crit_up) + Heroiczna Ballada
                    // (party_def_pen) before the mark consume. Without
                    // this the bard buffs only showed in the BuffBar but
                    // ally damage was identical to baseline.
                    const allyFxIdBuff = `trainer_ally_${ally.id}`;
                    const allyStBuff = effectsRef.current.statuses.get(allyFxIdBuff);
                    if (allyStBuff && allyStBuff.atkBuffMs > 0 && allyStBuff.atkBuffPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStBuff.atkBuffPct / 100)));
                    }
                    // Heroiczna Ballada (party_def_pen:40:10000) — Trainer
                    // dummies are synthetic (no real defence stat), so
                    // we visualise the def-pen buff as a flat damage
                    // bonus equal to the def-pen percent. Real-combat
                    // views (Boss/Hunt/Dungeon/Raid) reduce the target's
                    // defence stat directly via the same atom.
                    if (allyStBuff && allyStBuff.defPenMs > 0 && allyStBuff.defPenPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStBuff.defPenPct / 100)));
                    }
                    // War Song (party_crit_up:30:12000) — flat % chance
                    // each ally swing crits for 2× damage during window.
                    let isCrit = false;
                    if (allyStBuff && allyStBuff.partyCritMs > 0 && allyStBuff.partyCritPct > 0) {
                        if (Math.random() * 100 < allyStBuff.partyCritPct) {
                            isCrit = true;
                            dmg = Math.floor(dmg * 2);
                        }
                    }
                    // 2026-05 v7: Pieśń Wszechświata
                    // (party_instant_kill_chance_next) — every ally
                    // swing rolls the chance, decrements the count.
                    let universeIKAlly = false;
                    if (allyStBuff && allyStBuff.nextAllyInstantKillPct.length > 0) {
                        const topIK = allyStBuff.nextAllyInstantKillPct[0];
                        if (topIK.count > 0) {
                            if (Math.random() * 100 < topIK.pct) universeIKAlly = true;
                            topIK.count -= 1;
                            if (topIK.count <= 0) allyStBuff.nextAllyInstantKillPct.shift();
                        }
                    }
                    if (universeIKAlly) {
                        fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                        addLog(`:skull: ${ally.name ?? 'Sojusznik'}: DEATH ATTACK!`);
                    }
                    // 2026-05 v7: ally basics consume Klątwa Śmierci AND
                    // get Kraina Śmierci ×N — every attacker (player /
                    // summon / ally / bot) benefits from the marks.
                    const dummyStAlly = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampAlly = consumeTargetMarkAmp(dummyStAlly);
                    if (ampAlly.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampAlly.mult));
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, dmg, 'ally-basic', { isCrit });
                    // 2026-05 v6: each ally has their own v2 status (
                    // partyStatus index from effectsCastSkill). Boski
                    // Filar / Sąd Boży push charges onto every ally's
                    // queue, so each ally's swing should drain its own
                    // queue and produce its own heal float on its slot.
                    const allyFxId = `trainer_ally_${ally.id}`;
                    const allySt = effectsRef.current.statuses.get(allyFxId);
                    if (allySt) {
                        const allyMods = consumeCasterBasicHitMods(allySt);
                        const allySlot = slotOfMember(ally.id);
                        if (allyMods.lifestealPct > 0 && dmg > 0) {
                            const heal = Math.max(1, Math.floor(dmg * (allyMods.lifestealPct / 100)));
                            const realMaxHp = ally.maxHp || 100;
                            const cur = botHpMap[ally.id] ?? 100;
                            const barHeal = Math.max(1, Math.floor(heal / realMaxHp * 100));
                            const newHp = Math.min(100, cur + barHeal);
                            if (newHp !== cur) {
                                setBotHpMap((prev) => ({ ...prev, [ally.id]: newHp }));
                            }
                            const tag = cur >= 100 ? ' (MAX)' : '';
                            fx.pushAllyFloat(allySlot, heal, 'heal', {
                                icon: 'drop-of-blood',
                                label: tag ? `+${heal}${tag}` : undefined,
                            });
                        }
                        // next_ally_heal queue lives on the CASTER's
                        // status only (Sąd Boży is "tylko moja
                        // postać"), so allies never carry the buff
                        // and their attacks don't trigger any heal
                        // from this atom. The check on allyMods stays
                        // here purely as a safety no-op in case the
                        // engine ever pushes a queue onto bots.
                        if (allyMods.nextAllyHealPct > 0) {
                            // Intentionally empty — see comment above.
                            void allyMods.nextAllyHealPct;
                        }
                    }
                }
                // Ally skills — gated by autoSkill so the bot doesn't
                // spam casts when the toggle is OFF (was ignoring it).
                if (!autoSkill) continue;
                const allyCdMap = (allyCooldownsRef.current[ally.id] ??= {});
                const allySkills = getClassActiveSkills(ally.class)
                    .filter((s) => s.unlockLevel <= ally.level && s.damage > 0);
                for (const sk of allySkills) {
                    if ((allyCdMap[sk.id] ?? 0) > tick) continue;
                    allyCdMap[sk.id] = tick + Math.ceil(sk.cooldown / 500);
                    let dmg = Math.floor(allyAttack * sk.damage);
                    // 2026-05 v7: ally spells also benefit from
                    // Hymn Bitewny + War Song party buffs.
                    const allyStSp = effectsRef.current.statuses.get(`trainer_ally_${ally.id}`);
                    if (allyStSp && allyStSp.atkBuffMs > 0 && allyStSp.atkBuffPct > 0) {
                        dmg = Math.max(1, Math.floor(dmg * (1 + allyStSp.atkBuffPct / 100)));
                    }
                    let isCritSp = false;
                    if (allyStSp && allyStSp.partyCritMs > 0 && allyStSp.partyCritPct > 0) {
                        if (Math.random() * 100 < allyStSp.partyCritPct) {
                            isCritSp = true;
                            dmg = Math.floor(dmg * 2);
                        }
                    }
                    // 2026-05 v7: ally spells consume marks too.
                    const dummyStAllySp = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                    const ampAllySp = consumeTargetMarkAmp(dummyStAllySp);
                    if (ampAllySp.mult !== 1) {
                        dmg = Math.max(1, Math.floor(dmg * ampAllySp.mult));
                    }
                    pushDamage(dmg);
                    setDummyHitPulse((p) => p + 1);
                    fx.triggerEnemySkillAnim(0, sk.id);
                    fx.pushEnemyFloat(0, dmg, 'ally-spell', { icon: getSkillIcon(sk.id), isCrit: isCritSp });
                    break;
                }
            }

            // 2026-05 v6: drain ALL status timers on every dummy + the
            // player. `tickStatus` decrements stun / paralyze / immortal /
            // crit_buff / atk_buff / DOT remainingMs in one shot — same
            // path Combat / Boss / Dungeon use. Speed-scaled (x4 burns
            // 4× in-game time per real tick).
            const dotPerTickMs = 500 * speedMult; // 500ms = 2 trainer ticks
            // Pseudo-maxHp scales DOT numbers with the player's atk so a
            // lvl-1000 archer sees ~3000 dmg per tick on the dummy (which
            // is invincible) instead of a meaningless single digit.
            const pseudoMaxHp = Math.max(100, myAttack * 4);
            for (let dummyIdx = 0; dummyIdx < trainerCount; dummyIdx++) {
                const dummyId = TRAINER_DUMMY_FX_ID(dummyIdx);
                const dummyStatus = effectsRef.current.statuses.get(dummyId);
                if (!dummyStatus) continue;
                const r = tickStatus(dummyStatus, dotPerTickMs, pseudoMaxHp);
                if (r.dotDamage > 0) {
                    fx.pushEnemyFloat(dummyIdx, r.dotDamage, 'spell', { icon: 'skull-and-crossbones' });
                    pushDamage(r.dotDamage);
                    // 2026-05-15 v5 spec ("Na trainerze nie widze
                    // spelli sojusznikow w 100% jak np efektu DOT"):
                    // broadcast every DOT tick so other clients see
                    // the float + accumulate damage into their own
                    // counter (otherwise totals diverge from the
                    // caster's view).
                    if (isMultiHumanParty && character) {
                        const dmgCap = r.dotDamage;
                        const idxCap = dummyIdx;
                        const charIdCap = character.id;
                        const classCap = character.class;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: idxCap,
                                damage: dmgCap,
                                kind: 'spell',
                                icon: 'skull-and-crossbones',
                            });
                        }).catch(() => { /* offline */ });
                    }
                }
                // Necromancer Mroczny Rytuał — fired this tick. Trainer
                // dummies are invincible, but we still want the player
                // to see the proc and the damage that *would* have hit
                // a real enemy with that maxHp.
                if (r.darkRitualTriggered && r.darkRitualDamage > 0) {
                    fx.pushEnemyFloat(dummyIdx, r.darkRitualDamage, 'spell', { icon: 'skull', label: 'RITUAL', isCrit: true });
                    pushDamage(r.darkRitualDamage);
                    addLog(`:skull: Mroczny Rytuał: ${r.darkRitualDamage} dmg`);
                    // Broadcast Mroczny Rytuał too.
                    if (isMultiHumanParty && character) {
                        const dmgCap = r.darkRitualDamage;
                        const idxCap = dummyIdx;
                        const charIdCap = character.id;
                        const classCap = character.class;
                        void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                            usePartyCombatSyncStore.getState().publishTrainerAttack({
                                attackerId: charIdCap,
                                attackerClass: classCap,
                                dummyIdx: idxCap,
                                damage: dmgCap,
                                kind: 'spell',
                                icon: 'skull',
                                label: 'RITUAL',
                                isCrit: true,
                            });
                        }).catch(() => { /* offline */ });
                    }
                }
            }
            // Player status drain — keeps Orle Oko's crit_buff window
            // ticking down so the BuffBar timer matches reality.
            const playerStatusTick = effectsRef.current.statuses.get(TRAINER_PLAYER_FX_ID);
            if (playerStatusTick) tickStatus(playerStatusTick, dotPerTickMs, character?.max_hp ?? 1);
            // Each party ally — drain their status so party_immortal /
            // party_lifesteal_next windows actually expire on each bot.
            for (const m of partyMembers) {
                if (m.id === character?.id) continue;
                const allyStatus = effectsRef.current.statuses.get(`trainer_ally_${m.id}`);
                if (allyStatus) tickStatus(allyStatus, dotPerTickMs, m.maxHp || 100);
            }
            // Game-time buffs ticked globally by BuffBar (reads
            // combatSpeedMult from BuffStore set below).
            // Force a re-render so the dummy's stun/paralyze/immortal
            // countdown badges visibly drain — the v2 status state lives
            // in a ref (mutating doesn't trigger React) so we need this
            // beat to flush every tick.
            setStatusBeat((b) => (b + 1) & 0xffff);

            // Trainer hits back — only 1 damage per swing. Stun/paralyze
            // gate skips the swing entirely so a Pułapka / Strzała Wiatru
            // visibly stops the dummy from poking the player while the
            // CC is active.
            // 2026-05-15 v5 spec ("Usmiercenie dalej nie dziala"): in a
            // multi-human party, ONLY the leader runs the trainer-
            // hits-back simulation. Each member's local mirror would
            // otherwise treat the broadcast aggroTargetId (a real
            // character id) as a "bot" target and independently
            // drain THAT card's botHpMap -> on the next swing it dies
            // locally on the member's screen even though the leader
            // is the actual target. The leader's deadAllies broadcast
            // is the single source of truth.
            if (trainerAttacks && tick % 4 === 0 && (iAmLeader || !isMultiHumanParty)) {
                const dummyStunned = isCombatantStunned(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
                if (!dummyStunned) {
                    // 2026-05 v6: hit the chosen aggro target. 'player'
                    // -> local char takes 1 HP. Otherwise -> push a visual
                    // hit on the bot's slot (synthetic, no real HP loss
                    // because trainer party members are static 100/100
                    // by design — sandbox).
                    // 2026-05-15 v5: also recognize `character.id`
                    // (the actual local-player id) as "hit player"
                    // so the leader's path stays consistent even
                    // after the broadcast resolution flipped the
                    // sentinel.
                    if (aggroTargetId === 'player' || aggroTargetId === character?.id) {
                        // Knight Absolutne Cięcie immortal — block first.
                        const playerSt = effectsRef.current.statuses.get(TRAINER_PLAYER_FX_ID);
                        if (playerSt && playerSt.immortalMs > 0) {
                            fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
                            addLog(`:sparkles: BLOCK! Niewrażliwość`);
                            return;
                        }
                        // 2026-05 v6: Rogue Bomba Dymna (dodge_buff:50:4000)
                        // — % chance to fully dodge each incoming basic
                        // attack while the buff window is active. Was
                        // never wired in any combat view's incoming-
                        // damage path, so the buff icon showed in the
                        // BuffBar but the player still ate every hit.
                        if (playerSt && playerSt.dodgeBuffMs > 0 && playerSt.dodgeBuffPct > 0) {
                            if (Math.random() * 100 < playerSt.dodgeBuffPct) {
                                fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                                addLog(`:dashing-away: Bomba Dymna! Unik (${playerSt.dodgeBuffPct}%)`);
                                return;
                            }
                        }
                        // Mage Tarcza Many — 100% MP redirect. Trainer
                        // dummy hits for 1 dmg; if the sandbox has at
                        // least 1 MP, the hit goes there instead.
                        if (playerSt && playerSt.manaShieldMs > 0) {
                            if (sandboxMpRef.current > 0) {
                                sandboxMpRef.current = Math.max(0, sandboxMpRef.current - 1);
                                setSandboxMp(sandboxMpRef.current);
                                fx.pushAllyFloat(mySlot,1, 'spell', { icon: 'shield' });
                                addLog(`:shield: Tarcza Many pochłania 1 MP`);
                                return;
                            }
                        }
                        // Krok Cienia / Unik charge buff still gates here.
                        const dodgedByCharge = useBuffStore.getState().getBuffCharges('skill_charge_dodge_next') > 0;
                        if (dodgedByCharge) {
                            useBuffStore.getState().consumeBuffCharge('skill_charge_dodge_next');
                            addLog(`:dashing-away: Krok Cienia! Unik!`);
                            fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'dashing-away', label: 'UNIK' });
                        } else {
                            // Cleric Boska Tarcza — block_next_party charge
                            // eats the hit. Pre-empts HP loss.
                            const blockCharges = useBuffStore.getState().getBuffCharges('skill_charge_block_next_party');
                            if (blockCharges > 0) {
                                useBuffStore.getState().consumeBuffCharge('skill_charge_block_next_party');
                                addLog(`:shield: Boska Tarcza! Blok!`);
                                fx.pushAllyFloat(mySlot,0, 'heal', { icon: 'shield', label: 'BLOCK' });
                            } else {
                                // 2026-05 v6: Necromancer summon shield —
                                // front-of-queue summon (skeleton ->
                                // ghost -> demon -> lich) eats the hit
                                // BEFORE the necro takes HP damage.
                                // Dummy hit value is 1, so the summon
                                // either tanks 1 HP (still alive) or
                                // dies (queue removes it; necro takes
                                // any leftover, but at 1 dmg leftover
                                // = 0). The avatar then re-renders
                                // with the next summon's portrait.
                                if (character.class === 'Necromancer') {
                                    const necroStore = useNecroSummonStore.getState();
                                    if (necroStore.count(character.id) > 0) {
                                        const r2 = necroStore.damageFirst(character.id, 1);
                                        if (r2.dmgConsumed > 0) {
                                            fx.pushAllyFloat(mySlot,1, 'monster', { icon: 'skull' });
                                            addLog(`:skull: Summon przyjął 1 dmg (${r2.queueEmpty ? 'ostatni padł!' : 'wciąż żyje'})`);
                                            setPlayerHitPulse((p) => p + 1);
                                            return;
                                        }
                                    }
                                }
                                // 2026-05 v7: dummy hits for ~5% of player
                                // max HP so Bard Kołysanka (-25% enemy ATK)
                                // and Knight Umocnienie (+def buffs) show
                                // visible damage shifts. Pre-fix the dummy
                                // hit was hardcoded 1, making the -25%
                                // debuff floor to 0 and look broken.
                                let dummyDmg = Math.max(1, Math.floor(character.max_hp * 0.05));
                                const dummyStAtk = effectsRef.current.statuses.get(TRAINER_DUMMY_FX_ID(0));
                                if (dummyStAtk && dummyStAtk.enemyAtkDownMs > 0 && dummyStAtk.enemyAtkDownPct > 0) {
                                    dummyDmg = Math.max(1, Math.floor(dummyDmg * (1 - dummyStAtk.enemyAtkDownPct / 100)));
                                }
                                sandboxHpRef.current = Math.max(0, sandboxHpRef.current - dummyDmg);
                                setSandboxHp(sandboxHpRef.current);
                                setPlayerHitPulse((p) => p + 1);
                                // 2026-05-15 v15: use TRAINER_DUMMY_CLASS
                                // (Archer) for the strike overlay — the
                                // animation represents the dummy's swing,
                                // not the receiving player's class. Pre-
                                // fix Knight got hit and saw a Knight-
                                // style slash on their own card, which
                                // made no sense.
                                setPlayerAttackingClass(`attack-${TRAINER_DUMMY_CLASS}`);
                                window.setTimeout(() => setPlayerAttackingClass(null), ATTACK_FLASH_MS);
                                fx.pushAllyFloat(mySlot, dummyDmg, 'monster');
                                // 2026-05-15 v9 spec ("Inni sojusznicy
                                // nie widza tez ze mnie atakuje i ile
                                // zabiera mi HP przeciwnik, powinni
                                // widziec animacje za ile mnie bije"):
                                // broadcast every trainer-hits-player
                                // event so every other client renders
                                // the matching red 'monster' float on
                                // the player's slot in the SAME spot
                                // the local view shows.
                                if (isMultiHumanParty && character) {
                                    const dmgCap = dummyDmg;
                                    const charIdCap = character.id;
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                                            attackerId: 'monster',
                                            // 2026-05-15 v15: use Archer
                                            // for the strike style — the
                                            // dummy is the attacker, not
                                            // the player.
                                            attackerClass: TRAINER_DUMMY_CLASS,
                                            dummyIdx: 0,
                                            damage: dmgCap,
                                            kind: 'monster',
                                            targetAllyId: charIdCap,
                                        });
                                    }).catch(() => { /* offline */ });
                                }
                            }
                        }
                    } else {
                        // 2026-05 v6: aggro on a party bot — actually
                        // tick down the bot's sandbox HP so the bar
                        // shrinks. Lets the player watch a tank rotation
                        // (Knight pulls aggro before bot dies) or test
                        // Cleric heals on a real wounded ally. Each hit
                        // = 5% of max (5/100) so the bar drains visibly.
                        // Guard: if the target is now dead (sandbox kill
                        // picker), the dummy would keep swinging at a
                        // corpse — reset aggro to player and skip this
                        // swing.
                        // 2026-05-15 v11 spec ("Zabralo mu cale HP i
                        // dalej go targetuje a to jest blad"): also
                        // bail out when the target's HP is already 0
                        // (or about to be reduced below 0 on this
                        // swing). The previous check only honored
                        // `deadAllies`, but that Set updates AFTER
                        // the setBotHpMap callback's `killed` flag
                        // fires — leaving a one-tick window where
                        // the trainer kept swinging at a 0 HP card.
                        if (deadAllies.has(aggroTargetId) || (botHpMap[aggroTargetId] ?? 100) <= 0) {
                            setAggroTargetId('player');
                            return;
                        }
                        const targetSlot = slotOfMember(aggroTargetId);
                        if (targetSlot >= 0) {
                            // Cleric Wieża Bogów / Święta Apokalipsa —
                            // bot's `immortalMs > 0` blocks the entire
                            // hit (BLOCK float, no HP loss). Without
                            // this gate the dummy kept chunking 5%/hit
                            // through the supposed party_immortal.
                            const allyFxId = `trainer_ally_${aggroTargetId}`;
                            const allySt = effectsRef.current.statuses.get(allyFxId);
                            if (allySt && allySt.immortalMs > 0) {
                                fx.pushAllyFloat(targetSlot, 0, 'heal', { icon: 'sparkles', label: 'BLOCK' });
                                addLog(`:sparkles: BLOCK (party_immortal) -> slot ${targetSlot}`);
                            } else {
                                const dmg = 5; // out of 100 max
                                // 2026-05-15 v11: compute `killed`
                                // SYNCHRONOUSLY from the current
                                // botHpMap value (React 18 batches
                                // state updates so the `let killed`
                                // mutated inside setBotHpMap was
                                // racing the if-block below). Reads
                                // the SAME value the setBotHpMap
                                // callback would see on the next
                                // commit.
                                const curHpBefore = botHpMap[aggroTargetId] ?? 100;
                                const killed = curHpBefore > 0 && (curHpBefore - dmg) <= 0;
                                setBotHpMap((prev) => {
                                    const cur = prev[aggroTargetId] ?? 100;
                                    const next = Math.max(0, cur - dmg);
                                    if (next === cur) return prev;
                                    return { ...prev, [aggroTargetId]: next };
                                });
                                fx.pushAllyFloat(targetSlot, dmg, 'monster');
                                // 2026-05-15 v15 spec ("a powinna na
                                // targetowanym sojuszniku"): paint the
                                // strike overlay on the TARGETED ally's
                                // card via the per-ally map. Uses
                                // TRAINER_DUMMY_CLASS (Archer) so the
                                // animation matches the dummy's class,
                                // not the leader's.
                                const targetIdLocal = aggroTargetId;
                                setAllyAttackingClassMap((prev) => ({ ...prev, [targetIdLocal]: `attack-${TRAINER_DUMMY_CLASS}` }));
                                window.setTimeout(() => {
                                    setAllyAttackingClassMap((prev) => {
                                        if (!prev[targetIdLocal]) return prev;
                                        const next = { ...prev };
                                        delete next[targetIdLocal];
                                        return next;
                                    });
                                }, ATTACK_FLASH_MS);
                                // 2026-05-15 v9 spec ("Dalem
                                // targetowanie na sojusznika i
                                // sojusznik nie widzi ze dostaje
                                // obrazenia ani ze jest targetowany"):
                                // broadcast trainer-hits-ally so the
                                // targeted member sees the red float
                                // on their own card, and other
                                // members see them being hit too.
                                // 2026-05-15 v15: broadcast attackerClass
                                // as TRAINER_DUMMY_CLASS so receivers
                                // paint the strike with Archer style.
                                if (isMultiHumanParty && character) {
                                    const dmgCap = dmg;
                                    const targetIdCap = aggroTargetId;
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                                            attackerId: 'monster',
                                            attackerClass: TRAINER_DUMMY_CLASS,
                                            dummyIdx: 0,
                                            damage: dmgCap,
                                            kind: 'monster',
                                            targetAllyId: targetIdCap,
                                        });
                                    }).catch(() => { /* offline */ });
                                }
                                // 2026-05 v6: bot HP just hit 0 -> mark
                                // dead so the global "no actions on
                                // corpses + only revive_party can
                                // bring them back" rule kicks in.
                                if (killed) {
                                    setDeadAllies((prev) => {
                                        const nx = new Set(prev);
                                        nx.add(aggroTargetId);
                                        return nx;
                                    });
                                    setAggroTargetId('player');
                                    addLog(`:skull: ${aggroTargetId} padł — aggro wraca do gracza`);
                                }
                            }
                        }
                    }
                }
            }

            // Update real-time damage window (in case nothing fires this
            // tick — keeps the "current 5s" readout shrinking as old
            // events fall out of the window).
            const now = Date.now();
            const windowMs = BEST_WINDOW_BASE_MS / speedMult;
            windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= windowMs);
            const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
            setCurWindow(cur);
        }, Math.max(100, 500 / speedMult));
        return () => clearInterval(interval);
    }, [character, speedMult, autoBasic, autoSkill, trainerAttacks, noCooldowns, myAttack, trainerCount, activeSkillSlots, pushDamage, addLog, fx, rollBasicHit, partyMembers, deadAllies, aggroTargetId, dummyHpPct, isMultiHumanParty, iAmLeader]);

    // Auto-potion — restore SANDBOX HP/MP when below 50%. Real
    // characterStore HP/MP is never touched in Trainer (sandbox only).
    //
    // 2026-05 v7: PERMANENTLY SUPPRESSED after Apokalipsa Śmierci so
    // the intentional self-cost stays visible for the whole Trainer
    // session. The user explicitly said "po paru sekundach samo wraca
    // do 100% a nie powinno. Powinno zostac na 100%" — i.e. once HP
    // dropped via Apokalipsa, it must stay there until the next
    // Trainer mount. The suppress is reset on Trainer entry below.
    useEffect(() => {
        if (!autoPotion || !character) return;
        if (apokalipsaSuppressUntilRef.current > 0) return;
        const lowHp = sandboxHp < character.max_hp * 0.5;
        const lowMp = sandboxMp < character.max_mp * 0.5;
        if (lowHp || lowMp) {
            sandboxHpRef.current = character.max_hp;
            sandboxMpRef.current = character.max_mp;
            setSandboxHp(character.max_hp);
            setSandboxMp(character.max_mp);
        }
    }, [autoPotion, character, sandboxHp, sandboxMp]);

    const resetSession = () => {
        setTotalDmg(0); setBestWindow(0); setCurWindow(0);
        windowEventsRef.current = [];
        cooldownsRef.current = {};
        allyCooldownsRef.current = {};
        setSkillCooldownsMs({});
        addLog(':counterclockwise-arrows-button: Sesja zresetowana');
    };

    // Manual skill cast — triggered by clicking a slot in the action bar.
    // Works whether or not auto-skill is on; this is the answer to the
    // player's "I can't use spells when auto-skill is OFF" complaint.
    //
    // 2026-05 v6 rewrite: Trainer now honors the FULL effect spec — AOE
    // splashes the same damage on every active dummy, pure-buff skills
    // animate on the player instead of a dummy, and `applySkillBuff`
    // registers timed buffs in the BuffBar (Orle Oko / Bomba Dymna /
    // Tarcza Many / Okrzyk Bojowy etc.) so a player can sandbox-test
    // every spell here without going into a real fight.
    const doManualSkill = useCallback((slotIdx: number) => {
        if (!character) return;
        // 2026-05-15 v7 spec ("Usmiercilem sojusznika ... nie powinien
        // moc otrzymywac obrazen oraz atakowac ani spellem ani
        // atakiem nawet ... uzyje manualnie spella"): sandbox-killed
        // characters can't cast manual skills either. Their action
        // bar buttons still show cooldowns but the click is a no-op.
        if (deadAllies.has(character.id)) return;
        const slotId = activeSkillSlots[slotIdx];
        if (!slotId) return;
        const def = getClassActiveSkills(character.class).find((s) => s.id === slotId);
        if (!def) return;
        if (def.unlockLevel > character.level) return;
        // 2026-05 v7: Apokalipsa Śmierci — drives the HP cost
        // SYNCHRONOUSLY at the top of the cast handler, BEFORE the
        // effect engine runs and BEFORE any heal/buff consumer can
        // interfere. Reading `def.effect` directly (not the apply.flag)
        // guarantees the cost fires for the spell — the user reported
        // "Apokalipsa nie zabiera HP" repeatedly through a chain of
        // increasingly defensive fixes; doing it up-front + direct
        // store write removes every plausible race condition.
        //
        // Spec from user (final, 2026-05-07):
        //   - HP > 20% -> drop to 20%
        //   - HP between 5% and 20% -> drop to 3%
        //   - HP < 5% -> cast refused
        const isApocalypse = (def.effect ?? '').includes('death_apocalypse');
        if (isApocalypse) {
            // Use EFFECTIVE max HP (base + equipment + training + elixirs
            // + transform) — same scale the TopHeader bar uses. Pre-fix
            // the formula used `character.max_hp` (BASE only) so a 20%
            // drop on base scale showed as ~18% on the effective-scale
            // header bar. With effective max, the displayed bar ticks
            // exactly 20% per cast.
            const eff = getEffectiveChar(character);
            const effMax = eff?.max_hp ?? character.max_hp;
            const hpPct = sandboxHpRef.current / Math.max(1, effMax);
            if (hpPct < 0.05) {
                addLog(':broken-heart: Apokalipsa zablokowana: < 5% HP');
                return;
            }
            // Spec (final 2026-05-07):
            //   - HP > 20%  -> lose 20% of EFFECTIVE max HP per cast
            //                 (100->80->60->40->20 in successive casts)
            //   - 5% ≤ HP ≤ 20% -> drop directly to 3% of effective max
            //   - HP < 5%  -> cast refused (handled above)
            let newHpAfter: number;
            if (hpPct > 0.20) {
                newHpAfter = Math.max(1, sandboxHpRef.current - Math.floor(effMax * 0.20));
            } else {
                newHpAfter = Math.max(1, Math.floor(effMax * 0.03));
            }
            const lost = sandboxHpRef.current - newHpAfter;
            if (lost > 0) {
                // CRITICAL: arm auto-potion suppress BEFORE setSandboxHp.
                // MAX_SAFE_INTEGER means "never refill this session" —
                // user explicitly said HP must STAY low, not bounce back.
                apokalipsaSuppressUntilRef.current = Number.MAX_SAFE_INTEGER;
                sandboxHpRef.current = newHpAfter;
                setSandboxHp(newHpAfter);
                useCharacterStore.getState().updateCharacter({ hp: newHpAfter });
                fx.pushAllyFloat(mySlot,lost, 'spell', { icon: 'broken-heart', label: `-${lost} HP` });
                addLog(`:broken-heart: Apokalipsa: -${lost} HP`);
            }
        }
        const tick = tickRef.current;
        // No-CD toggle (sandbox) bypasses the per-skill cooldown gate so
        // the player can spam Krok Cienia / Strzała Śmierci back-to-back
        // for buff-stack / proc-chance testing.
        if (!noCooldowns && (cooldownsRef.current[def.id] ?? 0) > tick) return;
        if (!noCooldowns) {
            cooldownsRef.current[def.id] = tick + Math.ceil(def.cooldown / 500);
            setSkillCooldownsMs((prev) => ({ ...prev, [def.id]: def.cooldown }));
        }

        // 2026-05 v6: full classification — same as Combat/Boss/Dungeon.
        //   - damage > 0 -> damage hit, animate on enemy
        //   - damage = 0 + enemy-debuff atom (Pułapka stun:3000, Strzała
        //     Wiatru, mark_*, def_pen) -> animate on enemy
        //   - damage = 0 + self/party buff only (Orle Oko, Bomba Dymna,
        //     Tarcza Many, Okrzyk Bojowy) -> animate on player avatar
        const isDamageHit = def.damage > 0;
        const targetsEnemy = isDamageHit || skillTargetsEnemy(def.effect ?? null);
        const isAoe = (def.effect ?? '').split(';').some((a) => a.trim().toLowerCase().startsWith('aoe'));

        // Route the cast through the v2 effect engine — registers DOT/stun
        // /mark on the dummy status AND crit_buff/dmg_amp_next on the
        // player so basic attacks pick them up. dummyHpPct comes from the
        // slider so execute_below:N (Egzekucja, Skrytobójstwo) procs
        // when the slider is below threshold.
        // Include EVERY party member (alive + dead) in allyIds so
        // Holy Apocalypse's combined revive_party + party_immortal
        // lands the immortal buff on the v2 status BEFORE the bot is
        // raised — once revive clears the dead set, the just-revived
        // bot already carries immortalMs and resists the next swing.
        // Visual rule "no anim on dead" is enforced separately in the
        // float/animation pushes below.
        const manualPartyAllyIds = partyMembers
            .filter((m) => m.id !== character.id)
            .slice(0, 3)
            .map((m) => `trainer_ally_${m.id}`);
        const apply = effectsCastSkill({
            session: effectsRef.current,
            casterId: TRAINER_PLAYER_FX_ID,
            targetId: TRAINER_DUMMY_FX_ID(0),
            targetHpPct: dummyHpPct,
            effect: def.effect ?? null,
            allyIds: [TRAINER_PLAYER_FX_ID, ...manualPartyAllyIds],
            enemyIds: Array.from({ length: trainerCount }, (_, i) => TRAINER_DUMMY_FX_ID(i)),
        });

        // def_pen:N — Strzał Snajpera ignores monster def. Trainer dummies
        // have no defense (HP=100 invincible), but we still log the
        // "ignoruje obronę" message so the player knows the spell fired
        // its def_pen modifier.
        const defPenPct = apply.defPenPct ?? 0;
        let dmg = isDamageHit ? Math.floor(myAttack * def.damage * (1 + defPenPct / 100)) : 0;
        // instant_kill_chance success → finite execute burst. Trainer dummies
        // are invincible, so we use the same pseudo-maxHp the DOT path uses
        // (max(100, atk*4)) so the displayed burst is a meaningful number
        // instead of a one-shot. 12% of that, or the normal hit if bigger.
        if (isDamageHit && (apply.executeBurstPct ?? 0) > 0) {
            const trainerPseudoMaxHp = Math.max(100, myAttack * 4);
            dmg = Math.max(dmg, Math.floor(trainerPseudoMaxHp * (apply.executeBurstPct ?? 0) / 100));
        }
        // Necromancer Klątwa Śmierci (mark_amp) — first damage hit
        // (basic OR spell) on the marked target consumes the charge
        // and bumps damage by mult ×6 (= 500% more). Buff-only casts
        // skip (no dmg to amp).
        if (isDamageHit && dmg > 0) {
            const dummyStManual = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(0));
            const ampSpell = consumeTargetMarkAmp(dummyStManual);
            if (ampSpell.mult !== 1) {
                dmg = Math.max(1, Math.floor(dmg * ampSpell.mult));
                addLog(`:skull-and-crossbones: Klątwa Śmierci! ${def.id} ×${ampSpell.mult} dmg`);
            }
        }

        if (!targetsEnemy) {
            // Pure self/party buff: animate on player, no dummy hit.
            fx.triggerAllySkillAnim(mySlot, def.id);
            // 2026-05-15 v14 spec ("Jak uzywam orle oko to u
            // sojusznikow jeszcze jest animacja z napisem buff a na
            // moim ekranie nie"): also push the BUFF float on our
            // OWN slot — the receiver subscriber on every other
            // client already does this when it gets the broadcast,
            // so without the matching local push the caster sees
            // only the spell animation while every other ally also
            // sees the :sparkles: BUFF label. Symmetrise it.
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'BUFF' });
            addLog(`:sparkles: ${def.id}: BUFF`);
            // 2026-05-15 v5: broadcast pure-buff manual casts too so
            // every client sees the caster's animation + (filtered)
            // applies the buff in their BuffBar.
            if (isMultiHumanParty && character) {
                const idCap = def.id;
                const classCap = character.class;
                const charIdCap = character.id;
                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                        attackerId: charIdCap,
                        attackerClass: classCap,
                        dummyIdx: 0,
                        damage: 0,
                        kind: 'ally-spell',
                        icon: getSkillIcon(idCap),
                        skillId: idCap,
                        label: 'BUFF',
                    });
                }).catch(() => { /* offline */ });
            }
        } else {
            // Damage hit OR enemy debuff (Pułapka, Strzała Wiatru, etc.).
            // Primary dummy always gets the spell anim. Damage cast also
            // pushes a numeric float; pure-debuff casts (damage=0) just
            // get the spell glyph + the STUN/PARAL label below.
            fx.triggerEnemySkillAnim(0, def.id);
            // 2026-05-15 v9: match the receiver's "ally-slot anim on
            // every cast" behaviour locally — see the auto-skill
            // branch above for the spec reference.
            fx.triggerAllySkillAnim(mySlot, def.id);
            setDummyHitPulse((p) => p + 1);
            // 2026-05 v7: AOE pure-debuff casts (damage=0) also need the
            // spell anim on every other dummy. Pieśń Syren
            // (`aoe;enemy_no_heal:5000`) was animating only on the primary
            // because the splash-anim loop below is gated inside the
            // `isDamageHit` branch. Fire splash anims here for damage=0
            // AOE casts so the player sees the cast land on every enemy.
            if (isAoe && !isDamageHit) {
                for (let i = 1; i < trainerCount; i++) {
                    fx.triggerEnemySkillAnim(i, def.id);
                }
            }
            // 2026-05 v7: track total damage dealt this cast (primary +
            // every splash that actually landed). `heal_self_pct_dmg`
            // (Żniwa Dusz) heals on the SUM, not just the primary —
            // a 4-monster AOE with 50% lifesteal should heal 50% of all
            // four hits. Without this the spell only counted the primary
            // and felt useless on packs.
            let totalDmgDealtThisCast = 0;
            if (isDamageHit) {
                pushDamage(dmg);
                totalDmgDealtThisCast += dmg;
                fx.pushEnemyFloat(0, dmg, 'spell', { icon: getSkillIcon(def.id) });
                // 2026-05-15 v3: broadcast the manual skill hit so
                // every other client renders the same float + themed
                // overlay on their dummy (multi-human party only).
                if (isMultiHumanParty && character) {
                    const dmgCap = dmg;
                    const skillIdCap = def.id;
                    const classCap = character.class;
                    const charIdCap = character.id;
                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                        usePartyCombatSyncStore.getState().publishTrainerAttack({
                            attackerId: charIdCap,
                            attackerClass: classCap,
                            dummyIdx: 0,
                            damage: dmgCap,
                            kind: 'spell',
                            icon: getSkillIcon(skillIdCap),
                            skillId: skillIdCap,
                        });
                    }).catch(() => { /* offline */ });
                }
                if (isAoe) {
                    // Primary 100%, każdy splash dummy 75% (AOE falloff).
                    // Per-target IK roll dla AOE+IK skilli.
                    const splashDmgT = Math.max(1, Math.floor(dmg * 0.75));
                    const splashIkPctT = apply.instantKillPct ?? 0;
                    const trainerPseudoMaxHpSplash = Math.max(100, myAttack * 4);
                    for (let i = 1; i < trainerCount; i++) {
                        const splashIk = splashIkPctT > 0 && Math.random() * 100 < splashIkPctT;
                        fx.triggerEnemySkillAnim(i, def.id);
                        if (splashIk) {
                            // AOE re-roll of instant_kill_chance → finite
                            // execute burst (12% of pseudo-maxHp), not a kill.
                            const splashBurst = Math.max(splashDmgT, Math.floor(trainerPseudoMaxHpSplash * 12 / 100));
                            fx.pushEnemyFloat(i, splashBurst, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                            pushDamage(splashBurst);
                            totalDmgDealtThisCast += splashBurst;
                        } else {
                            // 2026-05 v7: each splash dummy consumes its
                            // own markAmp / markAmpAll so AOE Kraina hits
                            // ×2 on every dummy in the wave.
                            let splashFinal = splashDmgT;
                            const dummyStSplash = ensureStatus(effectsRef.current, TRAINER_DUMMY_FX_ID(i));
                            const ampSplash = consumeTargetMarkAmp(dummyStSplash);
                            if (ampSplash.mult !== 1) {
                                splashFinal = Math.max(1, Math.floor(splashFinal * ampSplash.mult));
                            }
                            fx.pushEnemyFloat(i, splashFinal, 'spell', { icon: getSkillIcon(def.id) });
                            pushDamage(splashFinal);
                            totalDmgDealtThisCast += splashFinal;
                            // 2026-05-15 v5 spec ("Jak uzywam spella AOE
                            // to mi pokazuje sie dobrze ze zabiera DMG
                            // wszystkim potworom ale sojusznikom juz
                            // nie"): broadcast each manual-cast splash
                            // so every client renders the float.
                            if (isMultiHumanParty && character) {
                                const dmgSplashCap = splashFinal;
                                const idxCap = i;
                                const skillIdCap = def.id;
                                const classCap = character.class;
                                const charIdCap = character.id;
                                void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                    usePartyCombatSyncStore.getState().publishTrainerAttack({
                                        attackerId: charIdCap,
                                        attackerClass: classCap,
                                        dummyIdx: idxCap,
                                        damage: dmgSplashCap,
                                        kind: 'spell',
                                        icon: getSkillIcon(skillIdCap),
                                        skillId: skillIdCap,
                                    });
                                }).catch(() => { /* offline */ });
                            }
                        }
                    }
                }
                const tags = [
                    isAoe ? 'AOE' : '',
                    defPenPct > 0 ? `ignoruje ${defPenPct}% DEF` : '',
                ].filter(Boolean).join(', ');
                addLog(`:sparkles: ${def.id}: ${dmg} dmg${tags ? ` (${tags})` : ''}`);
            } else {
                addLog(`:sparkles: ${def.id}: DEBUFF`);
            }
            // Stun / paralyze label — gated on the per-target apply
            // result. For AOE+stun_chance (Smite `aoe;stun_chance:30`)
            // each dummy rolls independently; the label appears ONLY
            // on the dummies that actually got stunned. Single-target
            // casts use the simple stunApplied flag against slot 0
            // (the primary dummy).
            if (isAoe) {
                if (apply.aoeStunIdxs.length > 0) {
                    for (const idx of apply.aoeStunIdxs) {
                        if (idx < trainerCount) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
                        }
                    }
                }
                if (apply.aoeParalyzeIdxs.length > 0) {
                    for (const idx of apply.aoeParalyzeIdxs) {
                        if (idx < trainerCount) {
                            fx.pushEnemyFloat(idx, 0, 'spell', { icon: 'locked', label: 'PARAL' });
                        }
                    }
                }
            } else if (apply.stunApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'dizzy', label: 'STUN' });
            } else if (apply.paralyzeApplied) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'locked', label: 'PARAL' });
            }
            // 2026-05 v6: DEATH ATTACK — instant_kill_chance / execute_below
            // / Skrytobójstwo procc'd. Push a special "DEATH ATTACK" float
            // on the targeted dummy regardless of whether it actually died
            // (Trainer dummies are invincible, but the player still wants
            // to see "I rolled the 5%!"). Crit-styled float for emphasis.
            if (apply.instantKill) {
                fx.pushEnemyFloat(0, 0, 'spell', { icon: 'skull', label: 'DEATH ATTACK', isCrit: true });
                addLog(`:skull: ${def.id}: DEATH ATTACK!`);
            }
            // 2026-05 v6: heal-on-cast (Mage Promień Pustki, Cleric
            // Pochłonięcie Życia, Necro Żniwa Dusz, …). Requires `dmg > 0`
            // so it only fires on damage skills — kept inside the
            // damage-hit branch.
            if (apply.healCasterPctOfDmg > 0 && totalDmgDealtThisCast > 0) {
                // Żniwa Dusz `aoe;heal_self_pct_dmg:50` — heal on TOTAL
                // damage (primary + every AOE splash). 4 enemies hit by
                // a single cast -> heal scales with all four hits.
                const heal = Math.floor(totalDmgDealtThisCast * (apply.healCasterPctOfDmg / 100));
                if (heal > 0) {
                    const before = sandboxHpRef.current;
                    sandboxHpRef.current = Math.min(character?.max_hp ?? before, before + heal);
                    setSandboxHp(sandboxHpRef.current);
                    const actual = sandboxHpRef.current - before;
                    const cappedTag = actual < heal ? ' (MAX)' : '';
                    // 2026-05 v6: Necromancer self-heals (Pochłonięcie
                    // Życia / Żniwa Dusz) target the NECRO, not the
                    // summon currently shown on the card. Label the
                    // float "(necro)" when a summon is on top so the
                    // player understands their pool went up even
                    // though the visible HP bar (= summon's) didn't.
                    const necroTag = (character?.class === 'Necromancer' && necroSummonsForPlayer.length > 0)
                        ? ' (necro)'
                        : '';
                    fx.pushAllyFloat(mySlot,heal, 'heal', {
                        icon: 'sparkles',
                        label: `+${heal}${cappedTag}${necroTag}`,
                    });
                    addLog(`:sparkles: ${def.id}: +${heal} HP${cappedTag}${necroTag}`);
                }
            }
        }
        // 2026-05 v6: pure-heal effects fire for BOTH damage casts and
        // pure self/party buffs. Cleric `heal` (damage:0,
        // heal_lowest_ally_pct:20) hits the !targetsEnemy branch above
        // — without these blocks living outside the if/else, the spell
        // ran the BUFF log line and never produced an actual heal.
        if (apply.healCasterPctOfMaxHp > 0 && character) {
            const heal = Math.floor(character.max_hp * (apply.healCasterPctOfMaxHp / 100));
            if (heal > 0) {
                const before = sandboxHpRef.current;
                sandboxHpRef.current = Math.min(character.max_hp, before + heal);
                setSandboxHp(sandboxHpRef.current);
                const actual = sandboxHpRef.current - before;
                const cappedTag = actual < heal ? ' (MAX)' : '';
                const necroTag = (character.class === 'Necromancer' && necroSummonsForPlayer.length > 0)
                    ? ' (necro)'
                    : '';
                fx.pushAllyFloat(mySlot,heal, 'heal', {
                    icon: 'sparkles',
                    label: `+${heal}${cappedTag}${necroTag}`,
                });
                fx.triggerAllySkillAnim(mySlot,def.id);
                addLog(`:sparkles: ${def.id}: +${heal} HP${cappedTag}${necroTag}`);
            }
        }
        // 2026-05 v6: Cleric Niebiańskie Leczenie / Modlitwa Niebios —
        // heal_party_pct. Heals every alive ally for N% of THEIR max
        // HP, with a heal float on each slot so the player can see
        // exactly how much each member recovered.
        if (apply.healPartyPctInstant > 0 && character) {
            // Player slot 0
            const playerHeal = Math.max(1, Math.floor(character.max_hp * (apply.healPartyPctInstant / 100)));
            const beforePlayer = sandboxHpRef.current;
            sandboxHpRef.current = Math.min(character.max_hp, beforePlayer + playerHeal);
            setSandboxHp(sandboxHpRef.current);
            const playerActual = sandboxHpRef.current - beforePlayer;
            const playerTag = playerActual < playerHeal ? ' (MAX)' : '';
            fx.pushAllyFloat(mySlot,playerHeal, 'heal', {
                icon: 'sparkles',
                label: playerTag ? `+${playerHeal}${playerTag}` : undefined,
            });
            fx.triggerAllySkillAnim(mySlot,def.id);
            // Each ALIVE bot ally — heal/buff spells skip dead party
            // members (only revive_party brings them back). "Dead"
            // means EITHER in deadAllies set OR HP=0 in the bar.
            const heal_partyMembers = partyMembers
                .filter((p) => p.id !== character.id)
                .slice(0, 3);
            for (let i = 0; i < heal_partyMembers.length; i++) {
                const m = heal_partyMembers[i];
                if (!m) continue;
                const cur = botHpMap[m.id] ?? 100;
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const realMaxHp = m.maxHp || 100;
                const realHeal = Math.max(1, Math.floor(realMaxHp * (apply.healPartyPctInstant / 100)));
                const barHeal = Math.max(1, Math.floor(100 * (apply.healPartyPctInstant / 100)));
                const newHp = Math.min(100, cur + barHeal);
                if (newHp !== cur) setBotHpMap((prev) => ({ ...prev, [m.id]: newHp }));
                const tag = cur >= 100 ? ' (MAX)' : '';
                const allySlot = slotOfMember(m.id);
                fx.pushAllyFloat(allySlot, realHeal, 'heal', {
                    icon: 'sparkles',
                    label: tag ? `+${realHeal}${tag}` : undefined,
                });
                fx.triggerAllySkillAnim(allySlot, def.id);
            }
            // Necromancer summons are SEPARATE entities — party heals
            // affect them too (per user spec "tak samo leczenie ich").
            if (character.class === 'Necromancer') {
                useNecroSummonStore.getState().healAllPct(character.id, apply.healPartyPctInstant);
            }
            addLog(`:sparkles: ${def.id}: heal_party_pct ${apply.healPartyPctInstant}%`);
        }
        // Cleric `heal` / `holy_nova` — heal_lowest_ally_pct. Picks the
        // ally with the lowest HP% across the live party (player
        // sandboxHp + bots from botHpMap, ignoring sandboxDead) and
        // heals them N% of their max HP. Float lands on THEIR slot +
        // spell anim so the player can see who got patched up. With
        // everyone at full HP, ties are broken in favour of the player
        // so the float ALWAYS lands on slot 0 (with a (MAX) tag).
        if (apply.healLowestAllyPct > 0 && character) {
            const allies: Array<{ slot: number; curHp: number; maxHp: number; realMaxHp?: number; setHp: (after: number) => void; name: string }> = [
                {
                    slot: mySlot,
                    curHp: sandboxHpRef.current,
                    maxHp: character.max_hp,
                    realMaxHp: character.max_hp,
                    setHp: (after) => {
                        sandboxHpRef.current = after;
                        setSandboxHp(after);
                    },
                    name: character.name,
                },
                // 2026-05 v6: dead allies CANNOT be the target of a
                // heal-lowest-ally cast — only the dedicated
                // revive_party atom can bring them back. Map by
                // GLOBAL slot via slotOfMember so the float lands on
                // the actual rendered card (the order is the same on
                // every client per the new stable ally ordering).
                ...otherPartyMembers
                    .map((m) => deadAllies.has(m.id) ? null : ({
                        slot: slotOfMember(m.id),
                        curHp: botHpMap[m.id] ?? 100,
                        maxHp: 100,
                        realMaxHp: m.maxHp || 100,
                        setHp: (after: number) => {
                            setBotHpMap((prev) => ({ ...prev, [m.id]: after }));
                        },
                        name: m.name,
                    }))
                    .filter((a): a is NonNullable<typeof a> => a !== null),
            ];
            let lowest = allies[0];
            let lowestRatio = lowest.curHp / Math.max(1, lowest.maxHp);
            for (let i = 1; i < allies.length; i++) {
                const ratio = allies[i].curHp / Math.max(1, allies[i].maxHp);
                if (ratio < lowestRatio) {
                    lowest = allies[i];
                    lowestRatio = ratio;
                }
            }
            // Float shows REAL heal (% of real maxHp) so it reads
            // realistically; bar fills against its own 100-max scale.
            const realMaxHp = (lowest as { realMaxHp?: number }).realMaxHp ?? lowest.maxHp;
            const heal = Math.floor(realMaxHp * (apply.healLowestAllyPct / 100));
            const barHeal = Math.floor(lowest.maxHp * (apply.healLowestAllyPct / 100));
            if (heal > 0) {
                const before = lowest.curHp;
                const after = Math.min(lowest.maxHp, before + barHeal);
                lowest.setHp(after);
                const actual = after - before;
                const cappedTag = actual < barHeal ? ' (MAX)' : '';
                fx.pushAllyFloat(lowest.slot, heal, 'heal', {
                    icon: 'sparkles',
                    label: cappedTag ? `+${heal}${cappedTag}` : undefined,
                });
                fx.triggerAllySkillAnim(lowest.slot, def.id);
                addLog(`:sparkles: ${def.id} -> ${lowest.name}: +${heal} HP${cappedTag}`);
            }
        }

        // 2026-05 v6: Cleric Aura Wskrzeszenia (revive_party). Raise
        // every sandbox-dead ally back to full HP. Without this the
        // spec's `revive_party:0:0` did nothing because both args
        // were zero (the atom only set cannotDieMs which is also 0).
        // The kill-ally picker drops bots into deadAllies; this clears
        // them and refills botHpMap so the bars come back to 100.
        if (apply.reviveDeadAllies) {
            // 2026-05 v6: a bot is "dead" if EITHER it's in the
            // sandbox-kill set OR its bar reads 0 HP (covers the
            // dummy-just-killed-them case before deadAllies updates).
            const revivedIds = new Set<string>();
            const revivedNames: string[] = [];
            for (const m of otherPartyMembers) {
                const inSet = deadAllies.has(m.id);
                const hpZero = (botHpMap[m.id] ?? 100) <= 0;
                if (inSet || hpZero) {
                    revivedIds.add(m.id);
                    revivedNames.push(m.name);
                }
            }
            if (revivedNames.length > 0) {
                setDeadAllies((prev) => {
                    const next = new Set(prev);
                    for (const id of revivedIds) next.delete(id);
                    return next;
                });
                setBotHpMap((prev) => {
                    const next = { ...prev };
                    for (const id of revivedIds) next[id] = 100;
                    return next;
                });
                // Float on each revived bot's slot + ally skill anim so
                // the player can see who got resurrected.
                for (let i = 0; i < otherPartyMembers.length; i++) {
                    const m = otherPartyMembers[i];
                    if (revivedIds.has(m.id)) {
                        const allySlot = slotOfMember(m.id);
                        fx.pushAllyFloat(allySlot, 100, 'heal', { icon: 'sparkles', label: '+REZ' });
                        fx.triggerAllySkillAnim(allySlot, def.id);
                    }
                }
                addLog(`:sparkles: ${def.id} -> wskrzeszono: ${revivedNames.join(', ')}`);
            } else {
                addLog(`:sparkles: ${def.id}: brak martwych sojuszników`);
            }
        }

        // 2026-05 v6: party_immortal (Cleric Wieża Bogów / Święta
        // Apokalipsa) — broadcast the spell anim on every alive ally
        // slot so each card flashes the buff. The actual immortalMs is
        // set on each ally's v2 status by applyEffects above; here we
        // just paint it on the cards. Speed-scaling: immortalMs is
        // game-time and tickStatus drains it × speedMult per tick, so
        // a 5s buff lasts 5s wall at x1, 2.5s at x2, 1.25s at x4.
        if (apply.partyImmortalMs > 0) {
            // Player slot
            fx.triggerAllySkillAnim(mySlot, def.id);
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
            for (let i = 0; i < otherPartyMembers.length; i++) {
                const m = otherPartyMembers[i];
                const cur = botHpMap[m.id] ?? 100;
                // Skip dead bots — but the underlying immortalMs IS
                // already on their v2 status (allyIds include dead),
                // so once revive_party clears them they're protected.
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const allySlot = slotOfMember(m.id);
                fx.triggerAllySkillAnim(allySlot, def.id);
                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'sparkles', label: 'IMMORTAL' });
            }
            addLog(`:sparkles: ${def.id}: party_immortal ${(apply.partyImmortalMs / 1000).toFixed(1)}s`);
        }
        // 2026-05 v7: Bard / Knight party-buff visualization. The atoms
        // (party_attack_up / party_as_up / party_crit_up / party_def_pen
        // / party_defense_up / party_lifesteal_next / enemy_atk_down)
        // already write to each ally's v2 status — but the player only
        // sees a buff in their OWN BuffBar. Without per-ally animations
        // it looks like "only the caster got the buff". Fire skill anim
        // + a labelled BUFF float on every alive ally so the player can
        // SEE the buff land on each card. The actual stat bonus is read
        // by the ally's basic-attack damage path (ATK% scaling, AS
        // cadence, crit chance — wired earlier in this view).
        const partyBuffAtoms = (def.effect ?? '').split(';').map((a) => a.trim().toLowerCase());
        const hasPartyBuff = partyBuffAtoms.some((a) =>
            a.startsWith('party_attack_up') ||
            a.startsWith('party_defense_up') ||
            a.startsWith('party_as_up') ||
            a.startsWith('party_crit_up') ||
            a.startsWith('party_def_pen') ||
            a.startsWith('party_lifesteal_next'),
        );
        if (hasPartyBuff) {
            // Player slot — ally skill anim already fires elsewhere when
            // !targetsEnemy, but party buffs animate on the player even
            // for self-cast bard tunes. Tag + float for clarity.
            fx.triggerAllySkillAnim(mySlot, def.id);
            fx.pushAllyFloat(mySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
            for (let i = 0; i < otherPartyMembers.length; i++) {
                const m = otherPartyMembers[i];
                const cur = botHpMap[m.id] ?? 100;
                if (deadAllies.has(m.id) || cur <= 0) continue;
                const allySlot = slotOfMember(m.id);
                fx.triggerAllySkillAnim(allySlot, def.id);
                fx.pushAllyFloat(allySlot, 0, 'heal', { icon: 'musical-note', label: 'BUFF' });
            }
        }
        // Enemy-debuff visualization — Kołysanka (enemy_atk_down) lands
        // a :sleeping-face: float on the dummy slot so the player has visual feedback.
        const hasEnemyDebuff = partyBuffAtoms.some((a) => a.startsWith('enemy_atk_down') || a.startsWith('enemy_no_heal'));
        if (hasEnemyDebuff) {
            for (let dIdx = 0; dIdx < trainerCount; dIdx++) {
                fx.pushEnemyFloat(dIdx, 0, 'spell', { icon: 'sleeping-face', label: 'DEBUFF' });
            }
        }

        // 2026-05 v6: aggro_steal (Knight Wicher / Cięcie Boga) snaps
        // the trainer dummy's target back to the caster. Lets the player
        // sandbox-test threat rotation: switch aggro to a bot, cast
        // Wicher, watch the dummy turn around and start hitting the
        // player again.
        // Necromancer summon spawn — `summon:type:count` atoms (Przywołaj
        // Szkieleta / Wskrześ Umarłych / Powstanie Apokalipsy / Przemiana
        // Lisza / Burza Dusz). Trainer was missing this call entirely so
        // the necro card never showed the summon avatar swap. Per-type
        // caps + HP fractions live in the store.
        if (apply.summons.length > 0 && character?.class === 'Necromancer') {
            const store = useNecroSummonStore.getState();
            for (const sm of apply.summons) {
                const spawned = store.spawn(character.id, sm.type, sm.count, myAttack, character.max_hp, character.max_mp);
                if (spawned > 0) {
                    addLog(`:skull: Przywołano ${spawned}× ${sm.type}`);
                    // Spawn animation: skill anim flash + a green
                    // "+SUMMON" float on the necro's slot so the
                    // player sees the summoning visually pop.
                    fx.triggerAllySkillAnim(mySlot,def.id);
                    // 2026-05 v7: per-type spawn animation (2s)
                    fx.triggerAllySummonSpawn(mySlot,sm.type);
                    fx.pushAllyFloat(mySlot,spawned, 'heal', {
                        icon: 'skull',
                        label: `+${spawned}× ${sm.type.toUpperCase()}`,
                    });
                }
            }
        }

        // 2026-05 v7: Apokalipsa Śmierci — target damage + summon spawn
        // (self-cost handled SYNCHRONOUSLY at the top of doManualSkill,
        // before any other consumer could interfere). The summon spawn
        // is handled by the generic `apply.summons` block above; this
        // remains only to push the dummy damage float.
        if (apply.deathApocalypse && character) {
            const dummyPseudoMaxHp = Math.max(100, myAttack * 4);
            const apocDmg = Math.max(1, Math.floor(dummyPseudoMaxHp * (apply.deathApocalypseTargetMaxHpPct / 100)));
            fx.pushEnemyFloat(0, apocDmg, 'spell', { icon: 'skull-and-crossbones', label: 'APOKALIPSA', isCrit: true });
            pushDamage(apocDmg);
            addLog(`:skull-and-crossbones: Apokalipsa Śmierci: ${apocDmg} dmg`);
        }

        if (apply.aggroSteal && aggroTargetId !== 'player') {
            setAggroTargetId('player');
            addLog(`:anger-symbol: Aggro przejęte na Ciebie!`);
        }

        // Multistrike (Wielostrzał) — fire N follow-up basic attacks on
        // the same dummy ~120ms apart. Each shows a basic-coloured float
        // so the player sees the burst.
        if ((apply.multistrike ?? 0) > 0) {
            const extra = Math.max(0, Math.floor(apply.multistrike));
            for (let n = 0; n < extra; n++) {
                window.setTimeout(() => {
                    const followup = rollBasicHit();
                    pushDamage(followup);
                    setDummyHitPulse((p) => p + 1);
                    fx.pushEnemyFloat(0, followup, 'basic');
                    addLog(`:bow-and-arrow:×${n + 2} ${followup} dmg`);
                }, 120 * (n + 1));
            }
        }

        // Register every timed self/party buff atom in the header BuffBar.
        const sd = getSkillDef(def.id);
        if (sd) applySkillBuff(def.id, sd, speedMult);
    }, [character, activeSkillSlots, myAttack, trainerCount, speedMult, noCooldowns, aggroTargetId, dummyHpPct, fx, pushDamage, addLog, rollBasicHit, deadAllies, isMultiHumanParty]);

    // 2026-05 v6: sync speed with global BuffStore so the central
    // BuffBar tick drains skill buffs at the matching rate.
    // NOTE (2026-05-25): moved ABOVE the `if (!character)` early-return so the
    // hook is registered on the first render even when character is null.
    // Same Rules of Hooks bug as Boss/Transform/Dungeon — early return between
    // hooks crashes the subtree on the next render after character hydrates
    // (hook count changes between renders). The effect doesn't touch character
    // so moving it is safe.
    useEffect(() => {
        useBuffStore.getState().setCombatSpeedMult(speedMult);
        return () => useBuffStore.getState().setCombatSpeedMult(1);
    }, [speedMult]);

    // 2026-05-25: necroSummons subscription ALSO moved here (was previously
    // line 3066, AFTER the early return). The store reads via
    // `summons[character.id]` — when character is null we fall back to an
    // empty string key which never matches -> store returns undefined -> the
    // `?? []` fallback yields an empty list. Identical visible behaviour as
    // returning empty when character is null, but the hook order is now
    // stable across renders.
    const necroSummonsForPlayer = useNecroSummonStore((s) => s.summons[character?.id ?? '']) ?? [];

    if (!character) {
        return (
            <div className="trainer trainer--loading">
                <Spinner size="lg" label="Wczytywanie postaci…" />
            </div>
        );
    }

    // -- Speed cycle (X1->X2->X4->X1) for the unified chip ----------------
    // BuffStore.combatSpeedMult sync is handled by the
    // useEffect([speedMult]) above. Calling Zustand inside the same
    // render that triggers React state updates caused TopHeader to
    // try re-rendering mid-Trainer-render.
    const cycleSpeed = () => {
        const idx = SPEED_OPTIONS.indexOf(speedMult);
        const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
        setSpeedMult(next);
    };

    // The damage window collapses with speed (real-time gets shorter at
    // x4) but the player thinks of it in IN-GAME time — they expect
    // "Best 5s" no matter the playback speed because the WINDOW length
    // in-game is still 5 seconds. So the label stays a constant "5s".
    const winLabel = `${BEST_WINDOW_BASE_MS / 1000}s`;

    // -- Enemy slots (1 invincible dummy in slot 0; pad to 4) ------------
    // The dummy uses the per-art image at /assets/images/trainer/trainer.png
    // instead of the legacy :bullseye: emoji.
    const uiEnemies: Array<ICombatEnemy | null> = (() => {
        const slots: Array<ICombatEnemy | null> = [];
        for (let i = 0; i < 4; i++) {
            if (i < trainerCount) {
                // 2026-05 v6: pull live status from the v2 effects session
                // so the player sees the stun / paralyze / immortal timer
                // tick down on each dummy. The countdown view re-renders
                // alongside `tickRef.current` (every 250ms when fighting)
                // because the parent component depends on it.
                const dummyStatus = effectsRef.current.statuses.get(TRAINER_DUMMY_FX_ID(i));
                slots.push({
                    id: `training-dummy-${i}`,
                    name: i === 0 ? 'Trening Dummy (∞)' : `Trening Dummy #${i + 1} (∞)`,
                    level: character.level,
                    sprite: 'bullseye',
                    kind: 'monster' as const,
                    currentHp: 100, // invincible — bar always full
                    maxHp: 100,
                    rarity: 'normal',
                    isDead: false,
                    // Only slot 0 is the player's primary target — additional
                    // dummies are auxiliary, no targeting ring on them.
                    isTargetedByPlayer: i === 0,
                    hitPulse: i === 0 ? dummyHitPulse : 0,
                    attackingClassName: i === 0 ? dummyAttackingClass : null,
                    skillAnim: fx.enemySkill[i] ?? null,
                    floats: fx.enemyFloats[i] ?? [],
                    imageUrl: trainerImg,
                    imageObjectFit: 'cover' as const,
                    statusOverlay: dummyStatus ? (() => {
                        // Necromancer Klątwa Śmierci — surface the
                        // longest-remaining active mark_amp charge so
                        // the badge :skull-and-crossbones: ×N · Ts can render.
                        const topAmp = dummyStatus.markAmp.find((m) => m.count > 0 && m.remainingMs > 0);
                        // Mroczny Rytuał — soonest-firing pending entry.
                        const topRitual = dummyStatus.darkRitualPending.length > 0
                            ? dummyStatus.darkRitualPending.reduce((a, b) => (a.triggerInMs <= b.triggerInMs ? a : b))
                            : null;
                        return {
                            stunMs: dummyStatus.stunMs,
                            immortalMs: dummyStatus.immortalMs,
                            markHealToDmgMs: dummyStatus.markNoHealMs,
                            markAmpMs: topAmp?.remainingMs,
                            markAmpMult: topAmp?.mult,
                            darkRitualMs: topRitual?.triggerInMs,
                            darkRitualPct: topRitual?.pctOfMaxHp,
                            markAmpAllMs: dummyStatus.markAmpAll?.remainingMs,
                            markAmpAllMult: dummyStatus.markAmpAll?.mult,
                            enemyAtkDownMs: dummyStatus.enemyAtkDownMs,
                            enemyAtkDownPct: dummyStatus.enemyAtkDownPct,
                            enemyNoHealMs: dummyStatus.enemyNoHealMs,
                        };
                    })() : undefined,
                });
            } else {
                slots.push(null);
            }
        }
        return slots;
    })();

    // 2026-05-15 spec ("Na trainerze taka sama kolejnosc jak u gory
    // powinna byc"): `orderedMembers` + `mySlot` + `slotOfMember`
    // are declared near the top of the component so the auto-attack
    // / auto-skill ticks can use them too. Here we just derive the
    // "other members" list for the leader-only top-controls' kill
    // and aggro pickers (modal lists of party members excluding
    // self).
    const otherPartyMembers = orderedMembers.filter((m) => m.id !== character.id).slice(0, 3);
    // Necromancer avatar swap — when summons are alive, the front-of-
    // queue summon's portrait replaces the necro's own image (per
    // user spec "skeleton zamiast na zdjeciu z necromanta"). Order
    // mirrors the damage-soak priority: skeleton -> ghost -> demon ->
    // lich. Lets the player see who's currently shielding them.
    // REACTIVE subscription via the hook (not getState()) so spawning
    // a new summon re-renders this view immediately. With getState()
    // the avatar swap waited for some unrelated state change.
    // NOTE (2026-05-25): `necroSummonsForPlayer` is now declared ABOVE the
    // early-return guard (see hook above) so its call site stays at a stable
    // hook position across renders. Reference here is just kept for the
    // surrounding derived constants (SUMMON_RANK / frontSummon).
    const SUMMON_RANK = { skeleton: 0, ghost: 1, demon: 2, lich: 3 } as const;
    const frontSummon = necroSummonsForPlayer.length > 0
        ? [...necroSummonsForPlayer].sort((a, b) => SUMMON_RANK[a.type] - SUMMON_RANK[b.type])[0]
        : null;
    const playerAvatar = (character.class === 'Necromancer' && frontSummon)
        ? (getSummonImage(frontSummon.type) ?? getCharacterAvatar(character.class, completedTransforms))
        : getCharacterAvatar(character.class, completedTransforms);
    // When a summon is the front avatar, the card represents that
    // summon entirely — its own name, HP/MP bars (per-type fraction
    // of necro's pool), and lifecycle. Damage to "the player" hits
    // the summon's HP first; once dead the next summon takes the
    // slot (or fall back to the necro). User spec.
    const SUMMON_LABELS: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
        skeleton: 'Szkielet',
        ghost: 'Duch',
        demon: 'Demon',
        lich: 'Lisz',
    };
    const playerName = (character.class === 'Necromancer' && frontSummon)
        ? SUMMON_LABELS[frontSummon.type]
        : character.name;
    // 2026-05-15 v10 spec ("HP na jednym ekranie a na drugim tym
    // dolnym mocno sie rozjezdza"): when the local player is a
    // member of a multi-human party (not the leader) AND the
    // leader's broadcast carries an entry for our character.id in
    // `botHpMap` (the leader's trainer-attack tick has been chipping
    // away at our card), mirror that percentage into the local
    // sandboxHp render so the bar drains in lockstep with what the
    // leader sees. The leader's view drains sandboxHpRef locally;
    // for members the only source of truth is the broadcast. Bot HP
    // map stores 0-100, scale by character.max_hp to get an absolute
    // value matching the card's bar math.
    const memberMirroredHp = (isMultiHumanParty && !iAmLeader && botHpMap[character.id] !== undefined)
        ? Math.floor(character.max_hp * (botHpMap[character.id] / 100))
        : null;
    const playerCardCurHp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.hp
        : Math.max(0, memberMirroredHp ?? sandboxHp);
    const playerCardMaxHp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.maxHp
        : character.max_hp;
    const playerCardCurMp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.mp
        : Math.max(0, sandboxMp);
    const playerCardMaxMp = (character.class === 'Necromancer' && frontSummon)
        ? frontSummon.maxMp
        : character.max_mp;
    const summonsByTypeMap: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
    for (const s of necroSummonsForPlayer) {
        summonsByTypeMap[s.type] = (summonsByTypeMap[s.type] ?? 0) + 1;
    }
    // 2026-05-15 spec ("Na trainerze taka sama kolejnosc jak u gory
    // powinna byc"): build the card for each ordered member at their
    // GLOBAL slot index so leader + every member see Krasek-then-
    // Knight (or whatever the party.members order is). The local
    // player's card may land at slot 0, 1, 2, or 3 depending on
    // where they sit in party.members; `mySlot` (computed above)
    // is the canonical slot index used by every self-targeted fx
    // push throughout the file.
    const uiAllies: Array<ICombatAlly | null> = orderedMembers.map<ICombatAlly>((m) => {
        const isSelf = m.id === character.id;
        const slotIdx = slotOfMember(m.id);
        // 2026-05-15 v8 spec ("niech na jego ekranie pokaze sie
        // ikonka czaski jak wyzej zeby wiedzial ze nie zyje tak jak
        // by"): when the local player is in `deadAllies` (the leader
        // sandbox-killed them via Uśmierć), render the SAME skull
        // overlay every other ally card gets so they can see they
        // are "dead". HP / MP bars stay at sandbox values per spec
        // — the skull is purely visual.
        const selfSandboxDead = isSelf && deadAllies.has(m.id);
        if (isSelf) {
            return {
                id: character.id,
                name: playerName,
                avatarUrl: playerAvatar,
                accentColor: myColor,
                className: character.class,
                currentHp: playerCardCurHp,
                maxHp: playerCardMaxHp,
                currentMp: playerCardCurMp,
                maxMp: playerCardMaxMp,
                isDead: selfSandboxDead,
                isPlayer: true,
                level: character.level,
                aggroCount: trainerAttacks && aggroTargetId === 'player' ? 1 : 0,
                summonCount: necroSummonsForPlayer.length || undefined,
                summonsByType: necroSummonsForPlayer.length > 0 ? summonsByTypeMap : undefined,
                onSummonClick: (type) => {
                    useNecroSummonStore.getState().despawnOne(character.id, type);
                    addLog(`:dashing-away: Odesłano: ${type}`);
                },
                hitPulse: playerHitPulse,
                attackingClassName: playerAttackingClass,
                skillAnim: fx.allySkill[slotIdx] ?? null,
                floats: fx.allyFloats[slotIdx] ?? [],
                summonSpawn: fx.allySummonSpawn[slotIdx] ?? null,
            };
        }
        // Remote ally card.
        const sandboxDead = deadAllies.has(m.id);
        const sandboxHpRemote = sandboxDead ? 0 : (botHpMap[m.id] ?? 100);
        const allyPresence = usePartyPresenceStore.getState().byMember[m.id];
        const allyTransformTier = allyPresence?.transformTier ?? 0;
        // 2026-05-15 v16 spec ("Jako sojusznik party nie widze
        // summonow necromanty a powinienem widziec"): if this remote
        // ally is a Necromancer whose presence broadcast carries a
        // live summon list, mirror the same front-summon avatar
        // swap + per-type badge counts that their own client renders
        // for themselves. Reads `allyPresence.summons` (broadcast by
        // the necro via partyPresence). Non-necros / empty lists
        // fall back to the base avatar.
        const remoteSummons = m.class === 'Necromancer' ? (allyPresence?.summons ?? []) : [];
        const remoteSummonsByType: Partial<Record<'skeleton' | 'ghost' | 'demon' | 'lich', number>> = {};
        for (const s of remoteSummons) {
            remoteSummonsByType[s.type] = (remoteSummonsByType[s.type] ?? 0) + 1;
        }
        const remoteFrontSummon = remoteSummons.length > 0
            ? [...remoteSummons].sort((a, b) => SUMMON_RANK[a.type] - SUMMON_RANK[b.type])[0]
            : null;
        const REMOTE_SUMMON_LABELS: Record<'skeleton' | 'ghost' | 'demon' | 'lich', string> = {
            skeleton: 'Szkielet', ghost: 'Duch', demon: 'Demon', lich: 'Lisz',
        };
        const remoteName = remoteFrontSummon ? REMOTE_SUMMON_LABELS[remoteFrontSummon.type] : m.name;
        const remoteAvatar = remoteFrontSummon
            ? (getSummonImage(remoteFrontSummon.type) ?? getCharacterAvatar(m.class, allyTransformTier ? [allyTransformTier] : []))
            : getCharacterAvatar(m.class, allyTransformTier ? [allyTransformTier] : []);
        return {
            id: m.id,
            name: remoteName,
            avatarUrl: remoteAvatar,
            accentColor: CLASS_COLORS[m.class] ?? '#888',
            className: m.class,
            currentHp: sandboxHpRemote,
            maxHp: 100,
            currentMp: sandboxDead ? 0 : 100,
            maxMp: 100,
            isDead: sandboxDead || sandboxHpRemote <= 0,
            isPlayer: false,
            isBot: !!m.isBot,
            level: m.level,
            aggroCount: aggroTargetId === m.id && trainerAttacks ? 1 : 0,
            // 2026-05-15 v15: per-ally attacking-class map — when the
            // trainer hits this ally the strike overlay (Archer
            // theme) paints on their card via the `attackingClassName`
            // prop.
            attackingClassName: allyAttackingClassMap[m.id] ?? null,
            skillAnim: fx.allySkill[slotIdx] ?? null,
            floats: fx.allyFloats[slotIdx] ?? [],
            // 2026-05-15 v16: surface remote summon counts so the
            // per-type badges (:skull:×N :ghost:×M :smiling-face-with-horns:×K :crown:×L) render on every
            // client, matching the necro's own card.
            summonCount: remoteSummons.length || undefined,
            summonsByType: remoteSummons.length > 0 ? remoteSummonsByType : undefined,
        };
    });
    while (uiAllies.length < 4) uiAllies.push(null);

    // -- Skill bar (read-only) — show the player's loadout with cooldown
    // sweeps. Trainer combat is fully automatic so the slots aren't
    // clickable (`disabled: true`); the visual purpose is to give the
    // player situational awareness ("my big AOE is coming back in 4s").
    const uiSkills: Array<ICombatSkillSlot | null> = activeSkillSlots.slice(0, 4).map((slotId, idx) => {
        if (!slotId) return null;
        const playerSkills = getClassActiveSkills(character.class);
        const def = playerSkills.find((s) => s.id === slotId);
        if (!def) return null;
        const cdMs = skillCooldownsMs[slotId] ?? 0;
        const totalMs = def.cooldown;
        const onCd = cdMs > 0;
        const locked = def.unlockLevel > character.level;
        return {
            id: slotId,
            icon: getSkillIcon(slotId),
            name: slotId,
            mpCost: def.mpCost,
            cooldownProgress: onCd ? 1 - cdMs / totalMs : 1,
            cooldownRemainingMs: cdMs,
            // Trainer doesn't drain MP — every cast is free, the only
            // gate is the per-skill cooldown so the player can spam
            // their loadout to verify rotations.
            disabled: onCd || locked,
            onClick: () => doManualSkill(idx),
        } as ICombatSkillSlot;
    });
    while (uiSkills.length < 4) uiSkills.push(null);

    return (
        <div className="trainer">
            <CombatHudHost active={true} accent={playerAccent} compact>
                <div className="combat-ui">
                    <CombatTopControls
                        // 2026-05-15 v2 spec ("Sojusznicy powinni tez
                        // widziec wszystkie guziki tylko miec
                        // mozliwosc klikania tylko 2 a jak lider party
                        // zmieni jakas opcje to wszyscy powinni
                        // widziec ta zmiane poza auto atakiem i auto
                        // spellami"): non-leader members SEE every
                        // chip (speed, trainerAttacks, noCooldowns,
                        // dummyHpPct, killAlly, aggro picker,
                        // trainerCount, reset) but every one is
                        // visually disabled. Only autoSkill +
                        // autoFight stay clickable for them — those
                        // are per-client (each client toggles their
                        // OWN local simulation of auto-fires).
                        // Other chips reflect the leader's broadcast
                        // (publishTrainerState -> mirror into local
                        // state via the subscriber below).
                        speed={{ label: `X${speedMult}`, onCycle: cycleSpeed, disabled: isNonLeaderMember }}
                        autoSkill={{ on: autoSkill, onToggle: () => setAutoSkill((v) => !v) }}
                        autoFight={{ on: autoBasic, onToggle: () => setAutoBasic((v) => !v) }}
                        // Trainer-only chips slot in via the `extras` slot —
                        // "trainer hits back" toggle + reset button — so
                        // they share the same sticky top bar as speed/auto.
                        extras={(() => {
                            const memberDisabled = isNonLeaderMember;
                            const disabledStyle: React.CSSProperties = memberDisabled
                                ? { opacity: 0.45, cursor: 'not-allowed' }
                                : {};
                            const memberTitle = 'Tylko lider party może zmieniać ten parametr';
                            return (
                                <>
                                    <button
                                        type="button"
                                        className={`combat-ui__chip${trainerAttacks ? ' combat-ui__chip--on' : ''}`}
                                        onClick={memberDisabled ? undefined : () => setTrainerAttacks((v) => !v)}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Trainer oddaje (1 HP / cios)'}
                                    >
                                        <GameIcon name="bullseye" /> {trainerAttacks ? 'ON' : 'OFF'}
                                    </button>
                                    {/* Sandbox: bypass per-skill cooldown so the
                                        player can spam any spell back-to-back to
                                        test charge stacks / proc chances / burst
                                        combos. Off by default. */}
                                    <button
                                        type="button"
                                        className={`combat-ui__chip${noCooldowns ? ' combat-ui__chip--on' : ''}`}
                                        onClick={memberDisabled ? undefined : () => setNoCooldowns((v) => !v)}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Wyłącz cooldowny skilli (sandbox)'}
                                    >
                                        <GameIcon name="stopwatch" /> Brak CD: {noCooldowns ? 'ON' : 'OFF'}
                                    </button>
                                    {/* Sandbox: dummy "HP %" — drives the
                                        targetHpPct passed to effectsCastSkill
                                        so execute_below atoms (Egzekucja
                                        <25%, Skrytobójstwo <20%) procc when
                                        the slider is below threshold. The
                                        dummy bar visual stays full (it's
                                        invincible) — only the cast roll uses
                                        this number. */}
                                    <label
                                        className="trainer__hp-slider"
                                        title={memberDisabled ? memberTitle : 'Symulowany % HP trainera dla execute_below (Egzekucja / Skrytobójstwo)'}
                                        style={disabledStyle}
                                    >
                                        <span className="trainer__hp-slider-label"><GameIcon name="drop-of-blood" /> Dummy HP:</span>
                                        <input
                                            type="range"
                                            min={0}
                                            max={100}
                                            step={5}
                                            value={dummyHpPct}
                                            disabled={memberDisabled}
                                            onChange={memberDisabled ? undefined : (e) => setDummyHpPct(parseInt(e.target.value, 10) || 0)}
                                        />
                                        <span className="trainer__hp-slider-val">{dummyHpPct}%</span>
                                    </label>
                                    {/* Sandbox: kill / revive party allies for
                                        rez / heal / shield spell testing. Pure
                                        cosmetic — no XP / item loss. */}
                                    {otherPartyMembers.length > 0 && (
                                        <button
                                            type="button"
                                            className="combat-ui__chip"
                                            onClick={memberDisabled ? undefined : () => setKillAllyPickerOpen(true)}
                                            aria-disabled={memberDisabled || undefined}
                                            style={disabledStyle}
                                            title={memberDisabled ? memberTitle : 'Uśmierć sojusznika (sandbox)'}
                                        >
                                            <GameIcon name="skull" /> Uśmierć
                                        </button>
                                    )}
                                    {/* Sandbox: switch trainer aggro to a
                                        chosen ally so the player can test
                                        Knight Wicher / Cięcie Boga (aggro_steal)
                                        by pulling threat back, or just
                                        practise tank rotations. */}
                                    {trainerAttacks && otherPartyMembers.length > 0 && (
                                        <button
                                            type="button"
                                            className="combat-ui__chip"
                                            onClick={memberDisabled ? undefined : () => setAggroPickerOpen(true)}
                                            aria-disabled={memberDisabled || undefined}
                                            style={disabledStyle}
                                            title={memberDisabled ? memberTitle : 'Zmień cel ataków trainera'}
                                        >
                                            <GameIcon name="bullseye" /> Cel: {(() => {
                                                if (aggroTargetId === 'player') return character.name;
                                                const m = otherPartyMembers.find((x) => x.id === aggroTargetId);
                                                return m ? m.name : 'Player';
                                            })()}
                                        </button>
                                    )}
                                    {/* Spec 8 (2026-05): cycle through 1..4 trainers
                                        on the field. Wraps back to 1 from 4. */}
                                    <button
                                        type="button"
                                        className="combat-ui__chip"
                                        onClick={memberDisabled ? undefined : () => setTrainerCount((n) => (n >= 4 ? 1 : n + 1))}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Dodaj trening dummy (max 4)'}
                                    >
                                        <Icon name="plus" /> Trainer ({trainerCount}/4)
                                    </button>
                                    <button
                                        type="button"
                                        className="combat-ui__chip"
                                        onClick={memberDisabled ? undefined : resetSession}
                                        aria-disabled={memberDisabled || undefined}
                                        style={disabledStyle}
                                        title={memberDisabled ? memberTitle : 'Reset sesji'}
                                    >
                                        <GameIcon name="counterclockwise-arrows-button" /> Reset
                                    </button>
                                </>
                            );
                        })()}
                    />

                    <CombatArena
                        enemies={uiEnemies}
                        allies={uiAllies}
                        bgVariant="default"
                        overlay={null}
                    />

                    {/* Sub-controls strip — `compact` floats the logs icon
                        to the top-right corner and hides the bag (no drops
                        in trainer). `xp={null}` suppresses the XP bar. */}
                    <CombatSubControls xp={null} />

                    <CombatActionBar
                        skills={uiSkills}
                        exit={{
                            kind: 'flee',
                            // Spec: trainer has NO penalty — exit just navigates.
                            //
                            // 2026-05-15 spec ("Jak jakis sojusznik
                            // wyjdzie z trainera to znika z widoku
                            // walki z trainerem ale nie wychodzi z
                            // party, tak samo jak lider wyjdzie z
                            // trainera to zostaje dalej liderem a
                            // reszta zostaje przeniesiona do miasta"):
                            //  - Member's flee: just clear session +
                            //    navigate home. Do NOT call leaveParty
                            //    — they remain in the party so the
                            //    leader can re-invite them or chain
                            //    them into another mode.
                            //  - Leader's flee in multi-human party:
                            //    broadcast combat-end so every other
                            //    member's `usePartyCombatSync`
                            //    listener pulls them back to city.
                            //    Leader stays leader of the party; no
                            //    transferLeadership / leaveParty
                            //    (trainer is meant to be re-startable
                            //    by the same leader after a brief
                            //    break).
                            onFlee: () => {
                                if (iAmLeader) {
                                    void import('../../stores/partyCombatSyncStore').then(({ usePartyCombatSyncStore }) => {
                                        usePartyCombatSyncStore.getState().publishCombatEnd();
                                    }).catch(() => { /* offline */ });
                                }
                                useCombatStore.getState().clearCombatSession();
                                navigate('/');
                            },
                        }}
                    />
                </div>
            </CombatHudHost>

            <div className="trainer__stats">
                <div><span>Całkowite obrażenia:</span> <strong>{totalDmg.toLocaleString('pl-PL')}</strong></div>
                <div><span>Ostatnie {winLabel}:</span> <strong>{curWindow.toLocaleString('pl-PL')}</strong></div>
                <div><span>Best {winLabel}:</span> <strong style={{ color: '#ffc107' }}>{bestWindow.toLocaleString('pl-PL')}</strong></div>
            </div>

            {/* 2026-05 v6: aggro target picker — modal listing every
                possible aggro target (player + party allies). Click to
                switch which one the trainer dummy hits when "Trainer
                oddaje" is on. aggro_steal cast (Wicher / Cięcie Boga)
                also auto-resets back to the player. Sandbox only. */}
            {aggroPickerOpen && (
                <div className="trainer__kill-overlay" onClick={() => setAggroPickerOpen(false)}>
                    <div className="trainer__kill-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="trainer__kill-title"><GameIcon name="bullseye" /> Wybierz cel ataków trainera</div>
                        <div className="trainer__kill-hint">
                            Trainer będzie atakował wybrany cel. Knight Wicher / Cięcie Boga (aggro_steal) automatycznie przeniesie cel z powrotem na Ciebie.
                        </div>
                        <ul className="trainer__kill-list">
                            <li className="trainer__kill-row">
                                <span className="trainer__kill-row-name">
                                    <span style={{ color: CLASS_COLORS[character.class] ?? '#fff' }}><Icon name="dot" /></span> {character.name}
                                    <small> (Ty, lvl {character.level} {character.class})</small>
                                </span>
                                <button
                                    type="button"
                                    className={`trainer__kill-row-btn${aggroTargetId === 'player' ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                    onClick={() => {
                                        setAggroTargetId('player');
                                        addLog(`:bullseye: Cel trainera: ${character.name}`);
                                        setAggroPickerOpen(false);
                                    }}
                                >
                                    {aggroTargetId === 'player' ? <><GameIcon name="check-mark-button" /> Aktywny</> : <><GameIcon name="bullseye" /> Wybierz</>}
                                </button>
                            </li>
                            {otherPartyMembers.map((m) => {
                                const isActive = aggroTargetId === m.id;
                                return (
                                    <li key={m.id} className="trainer__kill-row">
                                        <span className="trainer__kill-row-name">
                                            <span style={{ color: CLASS_COLORS[m.class] ?? '#fff' }}><Icon name="dot" /></span> {m.name}
                                            <small> (lvl {m.level} {m.class})</small>
                                        </span>
                                        <button
                                            type="button"
                                            className={`trainer__kill-row-btn${isActive ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                            onClick={() => {
                                                setAggroTargetId(m.id);
                                                addLog(`:bullseye: Cel trainera: ${m.name}`);
                                                setAggroPickerOpen(false);
                                            }}
                                        >
                                            {isActive ? <><GameIcon name="check-mark-button" /> Aktywny</> : <><GameIcon name="bullseye" /> Wybierz</>}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                        <button
                            type="button"
                            className="trainer__kill-close"
                            onClick={() => setAggroPickerOpen(false)}
                        >
                            Zamknij
                        </button>
                    </div>
                </div>
            )}

            {/* 2026-05 v6: kill-ally picker — modal listing every party
                member with a toggle (kill / revive). Sandbox only — does
                NOT affect real XP / equipment / character state. */}
            {killAllyPickerOpen && (
                <div className="trainer__kill-overlay" onClick={() => setKillAllyPickerOpen(false)}>
                    <div className="trainer__kill-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="trainer__kill-title"><GameIcon name="skull" /> Sandbox: uśmierć / wskrześ sojusznika</div>
                        <div className="trainer__kill-hint">
                            Tylko do testów spelli (rez / heal / tarcza). Brak konsekwencji — XP, eq i poziom postaci sojusznika pozostają nietknięte.
                        </div>
                        {otherPartyMembers.length === 0 ? (
                            <div className="trainer__kill-empty">Brak sojuszników w party.</div>
                        ) : (
                            <ul className="trainer__kill-list">
                                {otherPartyMembers.map((m) => {
                                    const isDead = deadAllies.has(m.id);
                                    return (
                                        <li key={m.id} className="trainer__kill-row">
                                            <span className="trainer__kill-row-name">
                                                <span style={{ color: CLASS_COLORS[m.class] ?? '#fff' }}><Icon name="dot" /></span> {m.name}
                                                <small> (lvl {m.level} {m.class})</small>
                                            </span>
                                            <button
                                                type="button"
                                                className={`trainer__kill-row-btn${isDead ? ' trainer__kill-row-btn--revive' : ' trainer__kill-row-btn--kill'}`}
                                                onClick={() => {
                                                    let nowKilled = false;
                                                    setDeadAllies((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(m.id)) {
                                                            next.delete(m.id);
                                                            addLog(`:sparkles: Wskrzeszono ${m.name} (sandbox)`);
                                                        } else {
                                                            next.add(m.id);
                                                            addLog(`:skull: Uśmiercono ${m.name} (sandbox, 0 konsekwencji)`);
                                                            nowKilled = true;
                                                        }
                                                        return next;
                                                    });
                                                    // 2026-05 v6: if we just killed the
                                                    // current aggro target the dummy would
                                                    // keep swinging at a corpse. Reset to
                                                    // the player so combat actually moves
                                                    // on. (Player can re-pick another bot
                                                    // via the aggro picker if they want.)
                                                    if (nowKilled && aggroTargetId === m.id) {
                                                        setAggroTargetId('player');
                                                        addLog(`:anger-symbol: Aggro spadło z ${m.name} -> wracasz do gracza`);
                                                    }
                                                }}
                                            >
                                                {isDead ? <><GameIcon name="sparkles" /> Wskrześ</> : <><GameIcon name="skull" /> Uśmierć</>}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        <button
                            type="button"
                            className="trainer__kill-close"
                            onClick={() => setKillAllyPickerOpen(false)}
                        >
                            Zamknij
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Trainer;
