import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { IWaveMonster, CombatPhase, IMonster } from './combatStore';
import type { TMonsterRarity } from '../systems/lootSystem';

/**
 * Realtime combat-sync layer for party fights — leader-authoritative.
 *
 * 2026-05-11 spec ("to sa kopie walki to jest blad"): party combat must
 * be ONE shared fight, not parallel copies. The leader's engine is the
 * single source of truth for monster state. Members are spectators
 * (with the ability to manually cast spells) — their local engine
 * never ticks during shared combat.
 *
 * Events on `party-combat-<partyId>`:
 *
 *   • `state` — full snapshot of the leader's shared arena: monster,
 *     monsterCurrentHp, waveMonsters, phase, wavePlannedCount,
 *     activeTargetIdx, monsterRarity. NEVER includes the leader's own
 *     playerCurrentHp/Mp — each member tracks their OWN HP/MP locally.
 *     Throttled to ~120 ms.
 *
 *   • `spell-cast` — any caster (leader or member) broadcasts when they
 *     cast a spell so the OTHER clients animate it. Members' manual
 *     casts go through this path too (auto-cast suppressed for members
 *     since their engine doesn't tick).
 *
 *   • `combat-speed` — leader's combat-speed setting (x1/x2/x4/SKIP).
 *     Members apply the same speed locally so engine ticks match.
 *
 *   • `victory` — leader's `phase === 'victory'` transition. Members
 *     mirror it so the post-fight popup opens together.
 *
 * No DB writes; channel is ephemeral.
 */

export interface IPartyCombatStateSnapshot {
    /** Character id of the broadcaster (always the leader for `state`). */
    senderId: string;
    /** Monotonic counter so out-of-order packets get dropped. */
    seq: number;
    phase: CombatPhase;
    waveMonsters: IWaveMonster[];
    wavePlannedCount: number;
    activeTargetIdx: number;
    monsterCurrentHp: number;
    monsterMaxHp: number;
    monster: IMonster | null;
    monsterRarity: TMonsterRarity;
    /** 2026-05-12 spec ("damage counter zawsze wspolne dla wszystkich
     *  co do milisekundy"): authoritative damage tally maintained by
     *  the leader. Members SET their local `partyDamageStore.damage`
     *  from this map (instead of accumulating their own counts via
     *  damage-event), so a dropped event doesn't permanently desync
     *  the tooltip — the next state broadcast restores parity. */
    partyDamage: Record<string, number>;
    /** Unix ms when leader emitted this packet. */
    sentAt: number;
}

export interface IPartySpellCast {
    casterId: string;
    skillId: string;
    label?: string;
    targetIdx?: number;
    isDamageHit?: boolean;
    casterName?: string;
    sentAt: number;
}

export interface IPartyCombatSpeed {
    /** x1 / x2 / x4 / SKIP — same union the local settingsStore uses. */
    speed: 'x1' | 'x2' | 'x4' | 'SKIP';
    sentAt: number;
}

/** Member → leader: "I attacked, please apply this damage on your
 *  authoritative state." Leader resolves on receipt and broadcasts a
 *  `damage-event` so EVERY client renders the same hit + updates
 *  their damage counter. */
export interface IPartyAttackAction {
    attackerId: string;
    attackerName: string;
    /** Damage value computed by the member's engine. Leader trusts it
     *  (no validation) — anti-cheat lives on the real server when we
     *  ship that; until then it's leader-honor-system. */
    damage: number;
    isCrit: boolean;
    /** Which wave slot the member was targeting at the moment of swing.
     *  Leader maps it to its OWN activeTargetIdx — typically they
     *  match because state is broadcast from leader, but if the
     *  member's view is briefly stale we still want the hit landing
     *  on the leader's current target rather than re-applying to a
     *  dead slot. */
    targetIdx: number;
    /** 'left' / 'right' for dual-wield, undefined for single hits. */
    hand?: 'left' | 'right' | null;
    sentAt: number;
}

/** Leader → all: "Player X just dealt Y damage to wave slot Z."
 *  Drives floating numbers, attack animations, and damage counters on
 *  every member's screen. The leader emits this for their OWN swings
 *  too (so members render the animation), and for incoming attack-
 *  actions from other members after they're applied. */
export interface IPartyDamageEvent {
    attackerId: string;
    attackerName: string;
    damage: number;
    isCrit: boolean;
    targetIdx: number;
    hand?: 'left' | 'right' | null;
    sentAt: number;
}

/** Leader → specific member: "Monster Z just hit you for N damage."
 *  The targeted member applies it to their own `character.hp`. Other
 *  members ignore (they're not the target). */
export interface IPartyMemberHit {
    /** Character id of the hit member. */
    memberId: string;
    damage: number;
    /** Wave slot that swung. */
    sourceMonsterIdx: number;
    sentAt: number;
}

/** Leader → all members: "Here's a single damage event from the boss
 *  combat tick." Used to mirror floating numbers + attack-class
 *  animations onto the member's view so their arena doesn't feel
 *  frozen between bossHp / playerHp broadcast snapshots.
 *
 *  2026-05-14 spec ("knight nie widzi zadnych animacji ani spelli ani
 *  atakow, powinien widziec je tak samo identycznie jak lider"): every
 *  meaningful hit on the leader's side now publishes one of these so
 *  the member replays the same float + attack-class pulse locally.
 *  Skill icons / label / kind let the float style match. */
export interface IPartyBossDamageEvent {
    /** Who attacked. 'player' = leader. 'boss' = the enemy. Otherwise
     *  the bot.id (which on the member side is the same id used in
     *  their mirrored botStore — leader broadcasts roster with stable
     *  ids). */
    attackerId: 'player' | 'boss' | string;
    /** Class of the attacker (drives swing animation). undefined for
     *  boss-sourced hits. */
    attackerClass?: import('../types/character').TCharacterClass;
    /** Receiver. 'boss' = boss took damage. 'player' = THIS recipient's
     *  player slot. Otherwise the receiving bot.id. */
    targetId: 'player' | 'boss' | string;
    damage: number;
    isCrit?: boolean;
    /** Float style — matches `TFloatKind` from `useCombatFx`. */
    kind?: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster' | 'monster-spell' | 'heal';
    /** Optional icon/label for the float (skill icon, status label,
     *  "BLOCK", "DODGE"). Same shape `fx.push*Float` expects. */
    icon?: string;
    label?: string;
    /** 2026-05-14: when an ally cast a spell, ship the skillId so the
     *  member can fire `triggerEnemySkillAnim(targetSlot, skillId)`
     *  and replay the same themed overlay (e.g. Mage's fire halo). */
    skillId?: string;
    sentAt: number;
}

/** Leader → all members: "Here's the current raid state."
 *  Mirrors the leader's authoritative wave-by-wave raid fight onto
 *  the member's Raid.tsx. Members suppress their own combat ticks
 *  and render the leader's currentWave / bosses / members directly.
 *  Throttled to ~120 ms internally; phase transitions always go
 *  through immediately so result popups open in sync. */
export interface IPartyRaidState {
    raidId: string;
    phase: 'lobby' | 'countdown' | 'fighting' | 'victory' | 'wipe';
    currentWave: number;
    /** Full boss snapshot — small array (<=5 per wave). */
    bosses: import('../types/raid').IRaidBossState[];
    /** Full member snapshot — small array (<=4). */
    members: import('../types/raid').IRaidMemberState[];
    /** 2026-05-14 spec ("Teraz tak wszystko zrob identycznie jak w
     *  polowaniu i bossie"): port speed-sync from boss to raid.
     *  Leader's current combat speed; member's local raid speedMult
     *  follows this on every snapshot so a late-joining member
     *  converges to the leader's actual current speed within one
     *  ~120 ms beat. */
    speedMode?: 'x1' | 'x2' | 'x4';
    /** 2026-05-14: per-boss aggro target map (bossId → memberId
     *  currently being targeted). Members mirror this so both screens
     *  highlight the same ally as the next victim of each boss. */
    aggroTargetIds?: Record<string, string>;
    /** 2026-05-14: authoritative party-damage tally so the floating
     *  PartyWidget reads the same numbers the leader sees (same shape
     *  as hunt + boss). */
    partyDamage?: Record<string, number>;
    /** 2026-05-15 spec ("Dropy na raidzie sie nie zgadzaja. Powinien
     *  kazdy widziec co inni gracze otrzymali z dropu"): leader's
     *  authoritative drop roll for every member, broadcast on the
     *  victory snapshot. Members display this verbatim instead of
     *  re-rolling locally — without this each client had its OWN
     *  RNG and the leader saw "Knight got epic", but Knight saw
     *  "common" on their own screen. */
    dropsByMember?: Record<string, import('../types/raid').IRaidDropLine[]>;
    /** 2026-05-15: items rolled by the leader for every member with
     *  full generated stats. Each receiving client looks up their own
     *  member id, addItem's whatever's there into their inventory, so
     *  the IDENTICAL gear shown in the result panel lands in their
     *  bag. The leader applies their own slice immediately in
     *  distributeRewards (so they don't have to wait for an echo). */
    itemsByMember?: Record<string, import('../types/item').IInventoryItem[]>;
    sentAt: number;
    seq: number;
}

/** Leader → all members: "Here's a single damage event from the raid
 *  combat tick." Same shape as `IPartyBossDamageEvent` but with a
 *  `targetBossId` (raids have multiple boss slots) instead of a
 *  singleton 'boss' marker.
 *
 *  2026-05-14 spec ("Teraz tak wszystko zrob identycznie jak w
 *  polowaniu i bossie"): the raid view only broadcasts a throttled
 *  state snapshot (~120 ms), so members never saw per-hit floats,
 *  attack animations, or DOT ticks — the boss bar just drifted down
 *  with no visual feedback. This event mirrors the per-hit float
 *  channel boss has so every meaningful hit on the leader's side
 *  replays as a float + attack-class pulse on every member's screen.
 */
export interface IPartyRaidDamageEvent {
    /** Who attacked. 'monster' = a raid boss. Otherwise the attacker's
     *  character id (or bot.id for AI teammates) — same id used in the
     *  shared members snapshot. */
    attackerId: 'monster' | string;
    /** Class of the attacker (drives swing animation). undefined for
     *  monster-sourced hits. */
    attackerClass?: import('../types/character').TCharacterClass;
    /** Receiver:
     *   - bossId → one of the raid's bosses
     *   - memberId → an ally card (own character, bot, or human mate). */
    targetId: string;
    /** When the attacker is a raid boss, this is the SOURCE boss id
     *  (different bosses cleave members concurrently — same `attackerId`
     *  'monster' would otherwise collide in the map). Undefined for
     *  ally-on-boss hits (the attackerId already disambiguates). */
    sourceBossId?: string;
    damage: number;
    isCrit?: boolean;
    /** Float style — matches `TFloatKind` from `useCombatFx`. */
    kind?: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster' | 'monster-spell' | 'heal';
    /** Optional icon/label for the float (skill icon, status label). */
    icon?: string;
    label?: string;
    /** Spell cast → ship skillId so the member can fire
     *  `triggerEnemySkillAnim` and replay the themed overlay. */
    skillId?: string;
    sentAt: number;
}

/** Leader → all members: "Here's the current boss-fight state."
 *  Drives the member's Boss.tsx view: they suppress their own combat
 *  ticks and render the leader's bossHp / phase / members directly.
 *  Throttled internally so the channel doesn't drown during fast
 *  combat. */
/** One ally card in the shared boss fight — the leader broadcasts ALL
 *  of them (themselves + bots) so the member can render an identical
 *  arena without running its own bot-generation logic. */
export interface IPartyBossAlly {
    /** Stable id — the leader's bot store id for bot slots, character.id
     *  for the leader's own card. */
    id: string;
    /** Character class — drives sprite/avatar lookup. */
    class: import('../types/character').TCharacterClass;
    /** Display name (real player name for humans, bot label otherwise). */
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    /** Killed during the fight (greyed-out card). */
    isDead: boolean;
    /** Is this card the broadcaster (leader)? Helps the member highlight
     *  the leader's slot the same way the leader highlights their own. */
    isLeader: boolean;
    /** For human party-mates: the character.id this bot slot represents.
     *  Members compare against their own character.id to skip "themselves
     *  as bot" when mirroring the leader's roster. Undefined for AI bots. */
    representsCharacterId?: string;
}

export interface IPartyBossState {
    /** id from data/bosses.json — used by member to look up sprite/name. */
    bossId: string;
    bossHp: number;
    scaledBossMaxHp: number;
    /** Matches Boss.tsx local ScreenPhase. Pre-fight / entry phases are
     *  short-lived and member-side animations don't need to mirror them
     *  exactly — they auto-start through their own ready-check payload. */
    phase: 'list' | 'fighting' | 'result';
    won?: boolean;
    /** Full ally roster as the leader sees it — leader's own card first,
     *  then bots/humans in slot order. Members render this verbatim
     *  instead of generating their own bots. Optional for staged
     *  rollout: when omitted, members fall back to their locally-
     *  generated bot composition. */
    allies?: IPartyBossAlly[];
    /** 2026-05-14 spec ("Na widoku lidera agroo pokazywalo ze jest
     *  atakowany lider, a na widoku sojusznika agroo pokazywalo ze
     *  jest atakowany sojusznik"): leader broadcasts who the boss is
     *  currently targeting so the indicator + visual aggro on both
     *  screens points to the same card. Values: 'player' (the leader
     *  themselves), or a bot.id (member-rep or AI). Members translate
     *  via `representsCharacterId` when matching against their own
     *  character to highlight their slot 0 self card. */
    aggroTargetId?: string;
    /** When phase === 'result': leader's computed XP and gold for the
     *  kill. Members credit their own pools with these values (same
     *  XP-per-kill across the whole party — matches hunt's
     *  monster-killed pattern). Drops stay local (each member still
     *  rolls their own loot table client-side). */
    earnedXp?: number;
    earnedGold?: number;
    /** 2026-05-14 spec ("nie zlicza sie suma zadanego DMG"):
     *  authoritative party-damage tally — same shape as hunt's snapshot
     *  (characterId → cumulative damage dealt this fight). Members SET
     *  their local partyDamageStore from this map so the floating
     *  PartyWidget reads the same numbers the leader sees. */
    partyDamage?: Record<string, number>;
    /** 2026-05-14 spec ("po wejsciu do walki ma pokazywac zawsze
     *  predkosc jaka ustawil lider"): leader's current combat speed.
     *  Members apply this on every snapshot so a late-joining member
     *  (or one who briefly lost the `combat-speed` broadcast) converges
     *  to the same speed within one boss-state tick (~120 ms). Without
     *  this the member's local speedMode would stay at the mount-time
     *  'x1' default until the leader manually clicked the speed button
     *  again. */
    speedMode?: 'x1' | 'x2' | 'x4';
    sentAt: number;
    seq: number;
}

/** Leader → all members: "Monster X just died — apply rewards."
 *
 * 2026-05-11 spec ("kazdy ma dostawac tyle samo XP"): the leader's
 * already-computed XP is shipped so EVERY member gets identical XP
 * per kill (same mastery bonus, same party bonus, same buffs from
 * the leader's perspective). Members still roll their OWN drops +
 * gold independently. Task / quest / mastery progress is tracked
 * per-character locally.
 *
 * 2026-05-12: added monotonic `seq` so the receiver can detect dropped
 * broadcasts (Supabase Realtime can lose events under high burst load
 * at x4 speed). When a gap is seen the receiver logs a warning so
 * we can quantify the loss rate in the wild.
 */
export interface IPartyMonsterKilled {
    monsterId: string;
    monsterLevel: number;
    monsterRarity: import('../systems/lootSystem').TMonsterRarity;
    /** Leader's already-calculated XP for this kill (mastery + party +
     *  buffs applied). Members use this directly to guarantee identical
     *  XP/h across the whole party. */
    finalXp: number;
    /** Monotonic counter — leader increments on every kill broadcast. */
    seq: number;
    sentAt: number;
}

/**
 * 2026-05-15 spec ("Trainer nie jest zsynchronizowany ... jak lider
 * party zmieni jakas opcje to wszyscy powinni widziec ta zmiane poza
 * auto atakiem i auto spellami"): leader-only broadcast of the
 * shared Trainer "sandbox" options. Each member's Trainer.tsx
 * mirrors these into local state on receive so the chip values they
 * SEE (read-only) match the leader's. Two settings are intentionally
 * EXCLUDED — `autoBasic` and `autoSkill` — because the spec says
 * those stay per-client (each client decides whether THEIR local
 * simulation auto-fires basics / skills).
 */
export interface IPartyTrainerState {
    /** 1 / 2 / 4 — drives tick cadence on every screen. */
    speedMult: 1 | 2 | 4;
    /** Whether the trainer dummy hits back (drives "trainer ataks"
     *  badge + per-client damage simulation). */
    trainerAttacks: boolean;
    /** Sandbox: skip per-skill cooldowns so chained casts test stacking. */
    noCooldowns: boolean;
    /** 1..4 dummies on the field. */
    trainerCount: number;
    /** Dummy HP% for execute_below atom procs. */
    dummyHpPct: number;
    /** Who the dummy attacks. 2026-05-15 v3 spec ("Dalem target zeby
     *  trainer bil Krasek a na jednym ekranie bije jedna postac a na
     *  drugiej inna to jest krytyczny blad"): ALWAYS resolved to a
     *  real character id at broadcast time. The 'player' sentinel
     *  would diverge across clients (each resolves it to their OWN
     *  local character), so the leader's "hit Krasek" became "hit
     *  Knight" on Knight's screen. Receivers set their local
     *  aggroTargetId to this exact id so every client agrees on the
     *  target card. */
    aggroTargetId: string;
    /** 2026-05-15 v3 spec ("Usmiercilem sojusznika i on dalej na 2
     *  ekranie zyje i atakuje potwory a nie powinien"): set of
     *  member ids the leader has sandbox-killed. Each member mirrors
     *  this into local deadAllies so the killed card visibly dies +
     *  the local auto-attack loop skips them (matches the leader's
     *  view exactly). */
    deadAllyIds: string[];
    /** 2026-05-15 v6 spec ("Trainer suma calkowitych obrazen i innych
     *  juz na wejsciu sie nie zgadza ... TO ma byc wspolny widok jak
     *  sie jest w party a nie kazdy osobny"): leader-authoritative
     *  shared damage counters. Members override their local values
     *  with these on every snapshot so all three boxes (Całkowite /
     *  Ostatnie 5s / Best 5s) line up 1:1 across every screen. */
    totalDmg: number;
    curWindowDmg: number;
    bestWindowDmg: number;
    /** Leader's sandbox HP/MP (their character's drainable trainer-
     *  combat pool). Broadcasted so members' view of the leader's
     *  card stays in lock-step with the leader's own. Per-member
     *  sandbox pools live in `memberSandboxHpMp` below. */
    leaderSandboxHp: number;
    leaderSandboxMp: number;
    /** Per-member sandbox HP/MP — character id → {hp, mp}. When a
     *  member casts a self-cost spell (e.g. Apokalipsa Śmierci)
     *  their HP drops; the entry is broadcast so the leader (and
     *  every other client) shows the matching bar position. */
    memberSandboxHpMp: Record<string, { hp: number; mp: number }>;
    /** Bot HP map for the sandbox party allies (kill-picker /
     *  trainer-hits-back drain this). Broadcasted authoritatively
     *  so members see the same bar drain as the leader. */
    botHpMap: Record<string, number>;
    sentAt: number;
}

/**
 * 2026-05-15 v3 spec ("Dlaczego widze 2 ataki skoro tylko sojusznik
 * wlaczyl atak w potwora a lider nie ... Dlaczego na ekranie wyzej
 * nie widze ataku sojusznika skoro wlaczyl go"): per-attack broadcast
 * so each client renders the actual attacks of EVERY player on the
 * shared dummy. Auto-attack / auto-skill stays per-client (each
 * client toggles ON/OFF for THEIR character) but every swing/cast
 * is published so other clients see the float + class-swing pulse +
 * skill animation on the attacker's slot.
 *
 * The receiving client uses `attackerId` to look up the attacker's
 * slot via the stable party.members order (slotOfMember helper) and
 * fires the same fx pushes the local simulation would. Self-events
 * are ignored (we already rendered our own attack locally).
 */
export interface IPartyTrainerAttack {
    /** 2026-05-15 v11: monotonic counter (per-broadcaster) that
     *  disambiguates events fired in the same millisecond — DOT ticks,
     *  AOE splashes, multistrike basics all hit Date.now() at x4
     *  speed. The receiver builds its dedup key from `attackerId +
     *  seq` so every published event lands in a distinct map slot. */
    seq: number;
    /** character.id of the attacker (the local player on the
     *  broadcasting client). For monster→ally events this is the
     *  literal sentinel 'monster'. */
    attackerId: string;
    /** Class — drives the attack-animation flash. */
    attackerClass: import('../types/character').TCharacterClass;
    /** Which dummy slot got hit (0..3). For monster→ally events
     *  (`targetAllyId` present) this is ignored. */
    dummyIdx: number;
    /** Damage dealt (already crit-multiplied). */
    damage: number;
    isCrit?: boolean;
    /** Float style. */
    kind: 'basic' | 'spell' | 'ally-basic' | 'ally-spell' | 'monster';
    /** Optional icon (skill id → emoji/sprite). */
    icon?: string;
    /** Optional label (e.g. "STUN", "APOKALIPSA", "BLOCK"). */
    label?: string;
    /** Spell cast → ship the skillId so the receiver fires the
     *  themed enemy + ally overlay. */
    skillId?: string;
    /** 2026-05-15 v9 spec ("Dalem targetowanie na sojusznika i
     *  sojusznik nie widzi ze dostaje obrazenia ani ze jest
     *  targetowany"): set when the trainer dummy hit a PARTY ALLY
     *  (kind='monster'). The character.id of the targeted ally —
     *  receivers resolve it via `slotOfMember(targetAllyId)` and
     *  fire the ally-side float + hit pulse on that slot. */
    targetAllyId?: string;
    sentAt: number;
}

interface IPartyCombatSyncState {
    lastAppliedSeq: number;
    lastSpellByCaster: Record<string, IPartySpellCast>;
    /** Last damage event per attacker — Combat.tsx watches this map
     *  and triggers floating numbers + monster-hit animations. */
    lastDamageByAttacker: Record<string, IPartyDamageEvent>;
    /** Last attack-action received (leader-only consumer state). */
    lastAttackAction: IPartyAttackAction | null;
    /** Last member-hit received (the targeted member's consumer state). */
    lastMemberHit: IPartyMemberHit | null;
    /** Last monster-killed event — members watch and apply own rewards. */
    lastMonsterKilled: IPartyMonsterKilled | null;
    /** Last boss-state event — member's Boss.tsx mirrors leader's authoritative state. */
    lastBossState: IPartyBossState | null;
    /** Last raid-state event — member's Raid.tsx mirrors leader's authoritative state. */
    lastRaidState: IPartyRaidState | null;
    channel: RealtimeChannel | null;
    partyId: string | null;

    subscribe: (partyId: string) => () => void;
    /** Leader-only: broadcast a shared-state snapshot. Throttled internally. */
    publishState: (snapshot: Omit<IPartyCombatStateSnapshot, 'seq' | 'sentAt'>) => void;
    /** Any member: broadcast a spell-cast animation cue. */
    publishSpellCast: (cast: Omit<IPartySpellCast, 'sentAt'>) => void;
    /** Leader-only: broadcast a combat-speed change. */
    publishCombatSpeed: (speed: IPartyCombatSpeed['speed']) => void;
    /** Leader-only: broadcast a victory event so members exit together. */
    publishVictory: (payload: { earnedXp: number; earnedGold: number }) => void;
    /** Any member: request the leader apply this basic-attack damage. */
    publishAttackAction: (action: Omit<IPartyAttackAction, 'sentAt'>) => void;
    /** Leader-only: broadcast a confirmed damage event (own or from a member request). */
    publishDamageEvent: (event: Omit<IPartyDamageEvent, 'sentAt'>) => void;
    /** Leader-only: tell a specific member they just took N damage. */
    publishMemberHit: (hit: Omit<IPartyMemberHit, 'sentAt'>) => void;
    /** Leader-only: announce a monster kill so members apply own rewards.
     *  `seq` is auto-assigned per call by the store (monotonic). */
    publishMonsterKilled: (k: Omit<IPartyMonsterKilled, 'sentAt' | 'seq'>) => void;
    /** Leader-only: broadcast the current boss-fight state. Throttled
     *  to ~120ms so we don't flood the channel during fast combat. */
    publishBossState: (s: Omit<IPartyBossState, 'sentAt' | 'seq'>) => void;
    /** Leader-only: tell members to skip the boss entry animation in
     *  lockstep with the leader's own skip. */
    publishBossEntrySkip: () => void;
    /** Wall-clock ms of the last received boss-entry-skip event. Boss.tsx
     *  watches this so members fire their own skipBossEntry handler when
     *  it bumps. */
    lastBossEntrySkipAt: number;
    /** 2026-05-13: client-local trigger used by the boss go-replicator to
     *  kick off the member's entry animation. The replicator fires from
     *  AppShell's useReadyCheckGoEffect (after Boss.tsx mounts in the
     *  commit phase), guaranteeing Boss.tsx's subscriber catches it
     *  even if the mount-time tryStart raced ahead of the destination
     *  being set. */
    pendingBossEntryAt: number;
    pendingBossEntryBossId: string | null;
    /** Local-only setter — does NOT broadcast on the channel. Called
     *  from registerGoReplicator('/boss', …) on the receiving client(s). */
    requestMemberBossEntry: (bossId: string) => void;
    /** 2026-05-14 spec ("Sojusznik ma ikonki jak w walce nie powinien
     *  jeszcze byc na widoku walki"): same pattern as boss for raids.
     *  The mount-time useEffect in Raid.tsx used to auto-start the
     *  fight whenever it saw a `/raid` destination in the ready-check
     *  store — including DURING the open phase, before everyone
     *  confirmed. That dropped the member into the combat view behind
     *  the popup. We now gate the auto-start on this go-replicator
     *  trigger so the raid only starts after `go` fires. */
    pendingRaidEntryAt: number;
    pendingRaidEntryRaidId: string | null;
    /** Local-only setter — does NOT broadcast on the channel. Called
     *  from registerGoReplicator('/raid', …) on the receiving client(s). */
    requestMemberRaidEntry: (raidId: string) => void;
    /** Last boss damage event PER attacker+target pair — member's
     *  Boss.tsx watches this map and replays the float + class-swing
     *  pulse so the arena animates in sync with the leader's tick.
     *
     *  2026-05-14 spec ("Zrob wszystkie animacje w bossie zeby kazdy
     *  sojusznik widzial tak samo a dokladnie jjak na ekranie u gory"):
     *  refactored from a single field to a map (mirrors hunt's
     *  `lastDamageByAttacker`) because boss AOE fires 4+ publishes in
     *  the same microtask (one per target) — with a single field only
     *  the last set survives, so the member's screen saw at most one
     *  AOE float. Keyed by `${attackerId}::${targetId}` so an AOE on
     *  player and an AOE on bot1 land in DIFFERENT map slots and the
     *  member's subscriber renders both. */
    lastBossDamageByAttacker: Record<string, IPartyBossDamageEvent>;
    /** Leader-only: broadcast a damage event. Fire-and-forget, no
     *  throttle (each tick is ≤ a few events so the channel can take
     *  the raw rate). */
    publishBossDamage: (ev: Omit<IPartyBossDamageEvent, 'sentAt'>) => void;
    /** 2026-05-14 spec ("pokonalem w party 3 razy Lich-krol, po czym
     *  wyszedlem z party jako sojusznik i moge dalej z nim walczyc"):
     *  explicit kill event that every party member listens to so they
     *  can burn an attempt in their LOCAL bossStore. Relying on the
     *  result-phase boss-state to derive this was unreliable: the
     *  subscriber's one-shot guard, async ordering of allies snapshot,
     *  and the `earnedXp` gate all meant a kill could land without
     *  consuming. This separate event is dedicated to the kill so the
     *  member's `setBossDefeated` cannot be missed.
     *  bossId = the killed boss; aliveMemberIds = char ids whose ally
     *  card was alive at kill time (only these consume an attempt). */
    lastBossKilled: { bossId: string; aliveMemberIds: string[]; sentAt: number } | null;
    publishBossKilled: (payload: { bossId: string; aliveMemberIds: string[] }) => void;
    /** Leader-only: broadcast the current raid state. Same throttle
     *  rules as boss-state. */
    publishRaidState: (s: Omit<IPartyRaidState, 'sentAt' | 'seq'>) => void;
    /** 2026-05-14: per-hit raid damage events keyed by
     *  `${attackerId}::${targetId}::${sourceBossId ?? ''}`. Mirrors the
     *  boss / hunt map pattern — AOE blasts that publish one event per
     *  target in the same microtask all land in distinct slots so the
     *  member's subscriber replays every float instead of dropping all
     *  but the last. */
    lastRaidDamageByAttacker: Record<string, IPartyRaidDamageEvent>;
    /** Leader-only: broadcast a raid damage event. No throttle — each
     *  tick is at most a few events. */
    publishRaidDamage: (ev: Omit<IPartyRaidDamageEvent, 'sentAt'>) => void;
    /** Last received Trainer leader-state broadcast — every member's
     *  Trainer.tsx mirrors this into local state so all the leader-only
     *  chips (speed, no-CD, dummy HP%, count, trainerAttacks, aggro)
     *  show the same values on every client. autoBasic / autoSkill
     *  are intentionally NOT in this payload — they stay per-client
     *  per spec. */
    lastTrainerState: IPartyTrainerState | null;
    /** Leader-only: broadcast the current shared Trainer options. */
    publishTrainerState: (s: Omit<IPartyTrainerState, 'sentAt'>) => void;
    /** 2026-05-15 v3: per-attack broadcast for the Trainer dummy.
     *  Keyed by attacker id so multiple players hitting in the same
     *  microtask each land in a unique map slot. Other clients
     *  iterate over new entries and replay the float + class swing
     *  on the attacker's ally slot + impact float on the dummy. */
    lastTrainerAttackByAttacker: Record<string, IPartyTrainerAttack>;
    /** Any player: broadcast their own swing/cast on the trainer
     *  dummy. Fire-and-forget, no throttle (each tick is a handful
     *  of events). Receivers de-dupe by reference identity per key. */
    publishTrainerAttack: (ev: Omit<IPartyTrainerAttack, 'sentAt' | 'seq'>) => void;
    /** Leader-only: broadcast a "combat ended, everyone back to town"
     *  signal. Members receive and navigate to `/` to mirror the
     *  leader's exit. Fired by the leader's stopCombat() when they
     *  click "Zakończ polowanie" / similar.*/
    publishCombatEnd: () => void;
    /** Last received combat-end timestamp (members watch this to
     *  trigger their own exit). */
    lastCombatEndAt: number;

    /**
     * 2026-05-17 spec ("wylaczylem auto spelle i nie moge ich uzywac
     * klikam non stop manualnie spella i nie dziala"): non-leader
     * members' manual skill clicks weren't firing because the raid /
     * boss engine only runs on the leader's client. The member's
     * `skillQueueRef.push(...)` lived locally and was never drained.
     *
     * Fix: members publish `member-skill-request {memberId, skillId}`
     * here. The leader's client consumes them into this map (memberId
     * → FIFO queue of skill ids) and the engine, when iterating that
     * member's slot, pops one off and treats it as a manual cast
     * (matching the local-player manual path: MP/CD checks, broadcast
     * the resulting damage). Each consumed entry is shifted out so the
     * next click can queue immediately.
     */
    pendingMemberSkillRequests: Record<string, string[]>;
    /** Any member: ask the leader to cast `skillId` for me on the next
     *  tick. No-op on the leader's own client (the leader's local
     *  queuePlayerSkill pushes into the engine's local skillQueueRef
     *  directly — they don't need to roundtrip through the channel). */
    publishMemberSkillRequest: (memberId: string, skillId: string) => void;
    /** Leader-only: pop the next pending skill id for a given member
     *  (returns null if the queue is empty). Called from the engine
     *  tick. */
    consumeMemberSkillRequest: (memberId: string) => string | null;

    clear: () => void;
}

const MIN_STATE_PUBLISH_MS = 120;
let lastPublishAt = 0;
let outboundSeq = 0;
let killSeqOutbound = 0;
let lastBossPublishAt = 0;
let bossSeqOutbound = 0;
let lastRaidPublishAt = 0;
let raidSeqOutbound = 0;
// 2026-05-15 v11: monotonic counter that disambiguates trainer-attack
// broadcasts fired in the same millisecond (DOT ticks, AOE splashes,
// multistrike basics — Date.now() alone collides under high load and
// the map key would overwrite earlier events before the receiver had
// a chance to render them).
let trainerAttackSeq = 0;

/**
 * Apply a leader-authoritative state snapshot to the local combatStore.
 * IMPORTANT: never touches playerCurrentHp / playerCurrentMp — those
 * are owned by the local player's character pool. The leader's HP/MP
 * is the leader's business; we only sync the SHARED arena state.
 */
const applyStateLocally = async (snap: IPartyCombatStateSnapshot): Promise<void> => {
    const { useCombatStore } = await import('./combatStore');
    useCombatStore.setState({
        phase:             snap.phase,
        waveMonsters:      snap.waveMonsters,
        wavePlannedCount:  snap.wavePlannedCount,
        activeTargetIdx:   snap.activeTargetIdx,
        monsterCurrentHp:  snap.monsterCurrentHp,
        monsterMaxHp:      snap.monsterMaxHp,
        monster:           snap.monster,
        monsterRarity:     snap.monsterRarity,
    });
    // 2026-05-12 spec ("damage counter zawsze wspolne, co do milisekundy"):
    // overwrite the local party-damage map with the leader's
    // authoritative tally. Members STOP accumulating locally via
    // damage-event for the counter (handled in Combat.tsx watcher);
    // the next state broadcast restores any drift caused by missed
    // realtime events.
    if (snap.partyDamage) {
        const { usePartyDamageStore } = await import('./partyDamageStore');
        const dmgState = usePartyDamageStore.getState();
        for (const [memberId, total] of Object.entries(snap.partyDamage)) {
            dmgState.setMemberDamage(memberId, total);
        }
    }
};

export const usePartyCombatSyncStore = create<IPartyCombatSyncState>()((set, get) => ({
    lastAppliedSeq: 0,
    lastSpellByCaster: {},
    lastDamageByAttacker: {},
    lastAttackAction: null,
    lastMemberHit: null,
    lastMonsterKilled: null,
    lastBossState: null,
    lastRaidState: null,
    lastBossEntrySkipAt: 0,
    pendingBossEntryAt: 0,
    pendingBossEntryBossId: null,
    pendingRaidEntryAt: 0,
    pendingRaidEntryRaidId: null,
    lastBossDamageByAttacker: {},
    lastRaidDamageByAttacker: {},
    lastBossKilled: null,
    lastTrainerState: null,
    lastTrainerAttackByAttacker: {},
    lastCombatEndAt: 0,
    pendingMemberSkillRequests: {},
    channel: null,
    partyId: null,

    subscribe: (partyId) => {
        const current = get();
        if (current.partyId === partyId && current.channel) return () => {};
        if (current.channel) {
            try { void supabase.removeChannel(current.channel); } catch { /* ignore */ }
        }

        const channel = supabase.channel(`party-combat-${partyId}`, {
            config: { broadcast: { self: false } },
        });

        channel.on('broadcast', { event: 'state' }, ({ payload }) => {
            const snap = payload as IPartyCombatStateSnapshot;
            if (!snap || typeof snap.seq !== 'number') return;
            const { lastAppliedSeq } = get();
            if (snap.seq <= lastAppliedSeq) return;
            set({ lastAppliedSeq: snap.seq });
            void applyStateLocally(snap);
        });

        channel.on('broadcast', { event: 'spell-cast' }, ({ payload }) => {
            const cast = payload as IPartySpellCast;
            if (!cast?.casterId || !cast?.skillId) return;
            set((s) => ({
                lastSpellByCaster: { ...s.lastSpellByCaster, [cast.casterId]: cast },
            }));
        });

        channel.on('broadcast', { event: 'combat-speed' }, async ({ payload }) => {
            const data = payload as IPartyCombatSpeed;
            if (!data?.speed) return;
            const { useSettingsStore } = await import('./settingsStore');
            useSettingsStore.getState().setCombatSpeed(data.speed);
        });

        channel.on('broadcast', { event: 'victory' }, async ({ payload }) => {
            const { earnedXp, earnedGold } = payload as { earnedXp: number; earnedGold: number };
            const { useCombatStore } = await import('./combatStore');
            useCombatStore.setState({
                phase: 'victory',
                earnedXp: earnedXp ?? 0,
                earnedGold: earnedGold ?? 0,
            });
        });

        channel.on('broadcast', { event: 'combat-end' }, () => {
            // Leader exited combat — bump the timestamp so the member's
            // listener (in usePartyCombatSync) fires and navigates to
            // town. We just store `Date.now()` because Realtime payload
            // can be empty here.
            set({ lastCombatEndAt: Date.now() });
        });

        channel.on('broadcast', { event: 'attack-action' }, ({ payload }) => {
            const action = payload as IPartyAttackAction;
            if (!action?.attackerId) return;
            // Only the LEADER consumes attack-action — they apply the
            // damage on their authoritative state and re-broadcast a
            // confirmed damage-event. Members store it for inspection
            // but otherwise ignore.
            set({ lastAttackAction: action });
        });

        channel.on('broadcast', { event: 'damage-event' }, ({ payload }) => {
            const ev = payload as IPartyDamageEvent;
            if (!ev?.attackerId) return;
            set((s) => ({
                lastDamageByAttacker: { ...s.lastDamageByAttacker, [ev.attackerId]: ev },
            }));
        });

        channel.on('broadcast', { event: 'member-hit' }, ({ payload }) => {
            const hit = payload as IPartyMemberHit;
            if (!hit?.memberId) return;
            set({ lastMemberHit: hit });
        });

        channel.on('broadcast', { event: 'monster-killed' }, ({ payload }) => {
            const k = payload as IPartyMonsterKilled;
            if (!k?.monsterId) return;
            set({ lastMonsterKilled: k });
        });

        channel.on('broadcast', { event: 'boss-state' }, ({ payload }) => {
            const s = payload as IPartyBossState;
            if (!s?.bossId || typeof s.seq !== 'number') return;
            const prev = get().lastBossState;
            // Drop out-of-order packets (Realtime can re-order under load).
            if (prev && s.seq <= prev.seq) return;
            set({ lastBossState: s });
        });

        channel.on('broadcast', { event: 'raid-state' }, ({ payload }) => {
            const s = payload as IPartyRaidState;
            if (!s?.raidId || typeof s.seq !== 'number') return;
            const prev = get().lastRaidState;
            if (prev && s.seq <= prev.seq) return;
            set({ lastRaidState: s });
        });

        channel.on('broadcast', { event: 'boss-entry-skip' }, () => {
            // No payload — bump the timestamp so the local Boss.tsx
            // subscriber re-fires its skipBossEntry handler.
            set({ lastBossEntrySkipAt: Date.now() });
        });

        channel.on('broadcast', { event: 'boss-damage' }, ({ payload }) => {
            const ev = payload as IPartyBossDamageEvent;
            if (!ev?.attackerId || !ev?.targetId) return;
            // 2026-05-14: keyed by attackerId+targetId so AOE
            // publishes (one per target, same attackerId='boss', same
            // microtask) all land in DISTINCT map slots — the
            // subscriber iterates and replays every float instead of
            // dropping all but the last.
            const key = `${ev.attackerId}::${ev.targetId}`;
            set((s) => ({
                lastBossDamageByAttacker: { ...s.lastBossDamageByAttacker, [key]: ev },
            }));
        });

        channel.on('broadcast', { event: 'raid-damage' }, ({ payload }) => {
            const ev = payload as IPartyRaidDamageEvent;
            if (!ev?.attackerId || !ev?.targetId) return;
            // 2026-05-14: raids cleave multiple members simultaneously
            // (4 bosses × 4 members → 16 hits/tick at peak) and a
            // single ally AOE can tag every boss in one swing — so
            // key includes the source boss id when the attacker is
            // 'monster' to avoid collisions across the 4 boss slots.
            const key = `${ev.attackerId}::${ev.targetId}::${ev.sourceBossId ?? ''}`;
            set((s) => ({
                lastRaidDamageByAttacker: { ...s.lastRaidDamageByAttacker, [key]: ev },
            }));
        });

        channel.on('broadcast', { event: 'boss-killed' }, ({ payload }) => {
            const ev = payload as { bossId: string; aliveMemberIds: string[]; sentAt: number };
            if (!ev?.bossId) return;
            set({ lastBossKilled: ev });
        });

        // 2026-05-15 spec ("jak lider party zmieni jakas opcje to
        // wszyscy powinni widziec ta zmiane poza auto atakiem i auto
        // spellami"): leader-broadcast Trainer sandbox options. Each
        // member's Trainer.tsx subscribes and mirrors these into the
        // local UI state so the chips visually match the leader's
        // choices (read-only on member side, see Trainer.tsx).
        channel.on('broadcast', { event: 'trainer-state' }, ({ payload }) => {
            const s = payload as IPartyTrainerState;
            if (!s || typeof s.speedMult !== 'number') return;
            set({ lastTrainerState: s });
        });

        // 2026-05-15 v3 + v5: per-attack trainer broadcast. Every
        // swing / spell cast / DOT tick / AOE splash on the shared
        // dummy publishes here so other clients render the matching
        // float + animation on the attacker's slot. Key includes
        // `sentAt` so high-frequency events don't overwrite each
        // other in the map.
        channel.on('broadcast', { event: 'trainer-attack' }, ({ payload }) => {
            const ev = payload as IPartyTrainerAttack;
            if (!ev?.attackerId || typeof ev.dummyIdx !== 'number') return;
            // 2026-05-15 v11: dedup key matches publisher's — uses the
            // monotonic per-broadcaster `seq` so two events with the
            // same `sentAt` ms each get their own slot in the map.
            const key = `${ev.attackerId}::${ev.seq ?? ev.sentAt}`;
            set((s) => ({
                lastTrainerAttackByAttacker: { ...s.lastTrainerAttackByAttacker, [key]: ev },
            }));
        });

        // 2026-05-17: members publish manual skill clicks here; the
        // leader pushes them onto their per-member queue and the
        // engine pops one per tick (matches the leader's local
        // skillQueueRef pattern). Members ignore inbound requests
        // (only the leader's engine consumes them).
        channel.on('broadcast', { event: 'member-skill-request' }, ({ payload }) => {
            const ev = payload as { memberId: string; skillId: string; sentAt: number };
            if (!ev?.memberId || !ev?.skillId) return;
            set((s) => {
                const prev = s.pendingMemberSkillRequests[ev.memberId] ?? [];
                return {
                    pendingMemberSkillRequests: {
                        ...s.pendingMemberSkillRequests,
                        [ev.memberId]: [...prev, ev.skillId],
                    },
                };
            });
        });

        channel.subscribe();
        set({
            channel, partyId,
            lastAppliedSeq: 0,
            lastSpellByCaster: {},
            lastDamageByAttacker: {},
            lastBossDamageByAttacker: {},
            lastRaidDamageByAttacker: {},
            lastAttackAction: null,
            lastMemberHit: null,
            lastBossState: null,
            lastRaidState: null,
            lastTrainerState: null,
            lastTrainerAttackByAttacker: {},
            pendingMemberSkillRequests: {},
        });

        return () => {
            const c = get().channel;
            if (c) {
                try { void supabase.removeChannel(c); } catch { /* ignore */ }
            }
            set({
                channel: null, partyId: null,
                lastAppliedSeq: 0,
                lastSpellByCaster: {},
                lastDamageByAttacker: {},
                lastBossDamageByAttacker: {},
                lastAttackAction: null,
                lastMemberHit: null,
                lastBossState: null,
                lastRaidState: null,
                lastTrainerState: null,
                lastTrainerAttackByAttacker: {},
                pendingMemberSkillRequests: {},
            });
        };
    },

    publishState: (snapshot) => {
        const now = Date.now();
        if (now - lastPublishAt < MIN_STATE_PUBLISH_MS) return;
        const { channel } = get();
        if (!channel) return;
        lastPublishAt = now;
        outboundSeq += 1;
        void channel.send({
            type: 'broadcast',
            event: 'state',
            payload: { ...snapshot, seq: outboundSeq, sentAt: now } satisfies IPartyCombatStateSnapshot,
        });
    },

    publishSpellCast: (cast) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        const full: IPartySpellCast = { ...cast, sentAt: now };
        set((s) => ({
            lastSpellByCaster: { ...s.lastSpellByCaster, [cast.casterId]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'spell-cast',
            payload: full,
        });
    },

    publishCombatSpeed: (speed) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'combat-speed',
            payload: { speed, sentAt: Date.now() } satisfies IPartyCombatSpeed,
        });
    },

    publishCombatEnd: () => {
        const { channel } = get();
        if (!channel) return;
        // No local mirror — leader is the publisher and navigates
        // themselves via their own exit-dialog handler. Only members
        // need the wake-up.
        void channel.send({
            type: 'broadcast',
            event: 'combat-end',
            payload: { sentAt: Date.now() },
        });
    },

    publishVictory: ({ earnedXp, earnedGold }) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'victory',
            payload: { earnedXp, earnedGold },
        });
    },

    publishAttackAction: (action) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        void channel.send({
            type: 'broadcast',
            event: 'attack-action',
            payload: { ...action, sentAt: now } satisfies IPartyAttackAction,
        });
    },

    publishDamageEvent: (event) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        const full: IPartyDamageEvent = { ...event, sentAt: now };
        // Mirror locally so the leader's own UI renders the float too
        // (other clients receive via channel).
        set((s) => ({
            lastDamageByAttacker: { ...s.lastDamageByAttacker, [event.attackerId]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'damage-event',
            payload: full,
        });
    },

    publishMemberHit: (hit) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        void channel.send({
            type: 'broadcast',
            event: 'member-hit',
            payload: { ...hit, sentAt: now } satisfies IPartyMemberHit,
        });
    },

    publishMonsterKilled: (k) => {
        const { channel } = get();
        if (!channel) return;
        const now = Date.now();
        killSeqOutbound += 1;
        void channel.send({
            type: 'broadcast',
            event: 'monster-killed',
            payload: { ...k, seq: killSeqOutbound, sentAt: now } satisfies IPartyMonsterKilled,
        });
    },

    publishBossState: (snapshot) => {
        const now = Date.now();
        // Phase transitions are too important to throttle (player needs
        // to see "result" instantly), so we always let those through.
        // Otherwise apply the standard ~120 ms gate.
        const prev = get().lastBossState;
        const phaseChanged = !prev || prev.phase !== snapshot.phase;
        if (!phaseChanged && now - lastBossPublishAt < MIN_STATE_PUBLISH_MS) return;
        const { channel } = get();
        if (!channel) return;
        lastBossPublishAt = now;
        bossSeqOutbound += 1;
        const full: IPartyBossState = { ...snapshot, seq: bossSeqOutbound, sentAt: now };
        // Mirror locally so the leader doesn't need a second subscriber
        // to read back their own current snapshot.
        set({ lastBossState: full });
        void channel.send({
            type: 'broadcast',
            event: 'boss-state',
            payload: full,
        });
    },

    requestMemberBossEntry: (bossId) => {
        set({ pendingBossEntryAt: Date.now(), pendingBossEntryBossId: bossId });
    },

    requestMemberRaidEntry: (raidId) => {
        set({ pendingRaidEntryAt: Date.now(), pendingRaidEntryRaidId: raidId });
    },

    publishBossDamage: (ev) => {
        const { channel } = get();
        if (!channel) return;
        const full: IPartyBossDamageEvent = { ...ev, sentAt: Date.now() };
        // 2026-05-14: map-keyed mirror (see channel handler above for
        // why). Leader's own UI doesn't subscribe to this (the leader
        // pushes floats directly inline), but member re-subscribers
        // still see a fresh map.
        const key = `${ev.attackerId}::${ev.targetId}`;
        set((s) => ({
            lastBossDamageByAttacker: { ...s.lastBossDamageByAttacker, [key]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'boss-damage',
            payload: full,
        });
    },

    publishRaidDamage: (ev) => {
        const { channel } = get();
        if (!channel) return;
        const full: IPartyRaidDamageEvent = { ...ev, sentAt: Date.now() };
        // Map-keyed mirror — see channel handler above for why the key
        // includes sourceBossId.
        const key = `${ev.attackerId}::${ev.targetId}::${ev.sourceBossId ?? ''}`;
        set((s) => ({
            lastRaidDamageByAttacker: { ...s.lastRaidDamageByAttacker, [key]: full },
        }));
        void channel.send({
            type: 'broadcast',
            event: 'raid-damage',
            payload: full,
        });
    },

    publishBossKilled: ({ bossId, aliveMemberIds }) => {
        const { channel } = get();
        if (!channel) return;
        const full = { bossId, aliveMemberIds, sentAt: Date.now() };
        set({ lastBossKilled: full });
        void channel.send({
            type: 'broadcast',
            event: 'boss-killed',
            payload: full,
        });
    },

    publishBossEntrySkip: () => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'boss-entry-skip',
            payload: { sentAt: Date.now() },
        });
    },

    publishRaidState: (snapshot) => {
        const now = Date.now();
        const prev = get().lastRaidState;
        const phaseChanged = !prev || prev.phase !== snapshot.phase;
        const waveChanged = !prev || prev.currentWave !== snapshot.currentWave;
        // 2026-05-14 spec ("zaciela sie walka nie przechodzi mi dalej"):
        // bypass the throttle when the live boss-alive count changed
        // (a kill landed) or any member just flipped to dead. The wave
        // transition fires from `setTimeout` AFTER the kill — without
        // this bypass, the "all bosses dead" state could be throttled
        // away and the member's view stayed at the previous frame with
        // a phantom-alive boss until the next wave's broadcast arrived
        // (or, if Supabase dropped that one packet, indefinitely).
        const prevAliveBosses = (prev?.bosses ?? []).filter((b) => !b.isDead).length;
        const nextAliveBosses = (snapshot.bosses ?? []).filter((b) => !b.isDead).length;
        const aliveBossesChanged = prevAliveBosses !== nextAliveBosses;
        const prevDeadMembers = (prev?.members ?? []).filter((m) => m.isDead).length;
        const nextDeadMembers = (snapshot.members ?? []).filter((m) => m.isDead).length;
        const deadMembersChanged = prevDeadMembers !== nextDeadMembers;
        if (
            !phaseChanged && !waveChanged &&
            !aliveBossesChanged && !deadMembersChanged &&
            now - lastRaidPublishAt < MIN_STATE_PUBLISH_MS
        ) return;
        const { channel } = get();
        if (!channel) return;
        lastRaidPublishAt = now;
        raidSeqOutbound += 1;
        const full: IPartyRaidState = { ...snapshot, seq: raidSeqOutbound, sentAt: now };
        set({ lastRaidState: full });
        void channel.send({
            type: 'broadcast',
            event: 'raid-state',
            payload: full,
        });
    },

    // 2026-05-15: trainer-state broadcast. Cheap (no throttle) because
    // the leader only fires it on actual chip clicks / slider drags,
    // not on every tick. The receiving member's Trainer.tsx subscribes
    // and copies the values into local React state so the chips
    // visibly match. autoBasic / autoSkill are deliberately EXCLUDED.
    publishTrainerState: (s) => {
        const now = Date.now();
        const { channel } = get();
        const full: IPartyTrainerState = { ...s, sentAt: now };
        set({ lastTrainerState: full });
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'trainer-state',
            payload: full,
        });
    },

    // 2026-05-15 v3 + v5: trainer-attack per-hit broadcast. Each
    // player calls this from their LOCAL auto / manual swing path
    // (basics, skills, DOT ticks, AOE splashes). Receivers iterate
    // the map and process each new entry. The key now includes
    // `sentAt` so high-frequency events (DOT ticks every 250ms, AOE
    // splashes that fire one per dummy in the same microtask) don't
    // collide and overwrite each other — every broadcast lands in a
    // distinct slot, the receiver replays every float exactly once.
    publishTrainerAttack: (ev) => {
        const now = Date.now();
        const { channel } = get();
        trainerAttackSeq += 1;
        const full: IPartyTrainerAttack = { ...ev, sentAt: now, seq: trainerAttackSeq };
        // 2026-05-15 v11: include the monotonic seq in the key so two
        // events fired in the same ms (AOE splash + DOT tick + buff
        // cast all colliding on Date.now() at x4 speed) each land in
        // distinct slots — the receiver iterates the map and replays
        // every entry, but it can only see entries that didn't get
        // overwritten before the next subscribe-fire.
        const key = `${ev.attackerId}::${full.seq}`;
        set((s) => ({
            lastTrainerAttackByAttacker: { ...s.lastTrainerAttackByAttacker, [key]: full },
        }));
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'trainer-attack',
            payload: full,
        });
    },

    publishMemberSkillRequest: (memberId, skillId) => {
        const { channel } = get();
        if (!channel) return;
        void channel.send({
            type: 'broadcast',
            event: 'member-skill-request',
            payload: { memberId, skillId, sentAt: Date.now() },
        });
    },

    consumeMemberSkillRequest: (memberId) => {
        const queue = get().pendingMemberSkillRequests[memberId];
        if (!queue || queue.length === 0) return null;
        const [head, ...rest] = queue;
        set((s) => {
            const next = { ...s.pendingMemberSkillRequests };
            if (rest.length === 0) {
                delete next[memberId];
            } else {
                next[memberId] = rest;
            }
            return { pendingMemberSkillRequests: next };
        });
        return head;
    },

    clear: () => {
        const { channel } = get();
        if (channel) {
            try { void supabase.removeChannel(channel); } catch { /* ignore */ }
        }
        outboundSeq = 0;
        lastPublishAt = 0;
        killSeqOutbound = 0;
        lastBossPublishAt = 0;
        bossSeqOutbound = 0;
        lastRaidPublishAt = 0;
        raidSeqOutbound = 0;
        set({
            channel: null,
            partyId: null,
            lastAppliedSeq: 0,
            lastSpellByCaster: {},
            lastDamageByAttacker: {},
            lastBossDamageByAttacker: {},
            lastRaidDamageByAttacker: {},
            lastAttackAction: null,
            lastMemberHit: null,
            lastMonsterKilled: null,
            lastBossState: null,
            lastRaidState: null,
            lastTrainerState: null,
            lastTrainerAttackByAttacker: {},
            lastBossEntrySkipAt: 0,
            lastCombatEndAt: 0,
            pendingMemberSkillRequests: {},
        });
    },
}));
