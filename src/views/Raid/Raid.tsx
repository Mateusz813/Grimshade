import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { useInventoryStore } from '../../stores/inventoryStore';
import { usePartyStore } from '../../stores/partyStore';
import { useRaidStore } from '../../stores/raidStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTransformStore } from '../../stores/transformStore';
import { getAllRaids, generateWaveBosses, rollMemberRewards } from '../../systems/raidSystem';
import { getSkillAnimation } from '../../data/skillAnimations';
import { applyDeathPenalty } from '../../systems/levelSystem';
import { getPartyGateLevel } from '../../systems/partySystem';
import skillsData from '../../data/skills.json';
import type {
    IRaid,
    IRaidBossState,
    IRaidMemberState,
    IRaidDropLine,
    RaidPhase,
} from '../../types/raid';
import './Raid.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const SPEED_OPTIONS: Array<{ label: string; mult: number }> = [
    { label: 'X1', mult: 1 },
    { label: 'X2', mult: 2 },
    { label: 'X3', mult: 3 },
    { label: 'X4', mult: 4 },
];

interface IActiveSkill {
    id: string;
    mpCost: number;
    cooldown: number;
    damage: number;
    effect: string | null;
    unlockLevel: number;
    class: string;
}

const getClassActiveSkills = (cls: string): IActiveSkill[] => {
    const key = cls.toLowerCase() as keyof typeof skillsData.activeSkills;
    const list = (skillsData.activeSkills[key] ?? []) as Array<Omit<IActiveSkill, 'class'>>;
    return list.map((s) => ({ ...s, class: cls }));
};

const isAoeSkill = (effect: string | null | undefined): boolean =>
    typeof effect === 'string' && effect.includes('aoe');

type MemberCooldownMap = Record<string, Record<string, number>>;
interface ISkillFx {
    id: number;
    skillId: string;
    targets: number[];
    expiresAt: number;
}

const Raid = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const leaveParty = usePartyStore((s) => s.leaveParty);
    const { attemptsRemaining, consumeAttempt } = useRaidStore();

    const raids = useMemo(() => getAllRaids(), []);
    const [phase, setPhase] = useState<RaidPhase>('lobby');
    const [selectedRaid, setSelectedRaid] = useState<IRaid | null>(null);
    const [speedMult, setSpeedMult] = useState(1);
    const [currentWave, setCurrentWave] = useState(0);
    const [bosses, setBosses] = useState<IRaidBossState[]>([]);
    const [members, setMembers] = useState<IRaidMemberState[]>([]);
    const [logLines, setLogLines] = useState<string[]>([]);
    const [skillFx, setSkillFx] = useState<ISkillFx[]>([]);
    const [dropsByMember, setDropsByMember] = useState<Record<string, IRaidDropLine[]>>({});
    const cooldownsRef = useRef<MemberCooldownMap>({});
    const tickIdRef = useRef(0);
    const bossesRef = useRef<IRaidBossState[]>([]);
    const membersRef = useRef<IRaidMemberState[]>([]);
    const phaseRef = useRef<RaidPhase>('lobby');
    const fxIdRef = useRef(0);

    useEffect(() => { bossesRef.current = bosses; }, [bosses]);
    useEffect(() => { membersRef.current = members; }, [members]);
    useEffect(() => { phaseRef.current = phase; }, [phase]);

    const iAmLeader = !!character && !!party && party.leaderId === character.id;
    const humanMembers = party?.members.filter((m) => !m.isBot) ?? [];
    const totalMembers = party?.members.length ?? 0;
    const partyMinLevel = getPartyGateLevel(character?.level ?? 1, party?.members);

    const addLog = useCallback((text: string) => {
        setLogLines((prev) => [...prev.slice(-40), text]);
    }, []);

    // ── Build member states from party + character ───────────────────────────
    const buildMemberStates = useCallback((): IRaidMemberState[] => {
        if (!character || !party) return [];
        const transformColor = useTransformStore.getState().getHighestTransformColor();
        const transformTier = useTransformStore.getState().getHighestCompletedTransform?.() ?? 0;
        return party.members.map((m) => {
            const isMe = m.id === character.id;
            if (isMe) {
                return {
                    id: m.id,
                    name: m.name,
                    class: character.class,
                    level: character.level,
                    maxHp: character.max_hp,
                    hp: character.max_hp,
                    maxMp: character.max_mp,
                    mp: character.max_mp,
                    attack: character.attack,
                    defense: character.defense,
                    isDead: false,
                    isBot: false,
                    hasEscaped: false,
                    color: transformColor?.solid ?? CLASS_COLORS[character.class] ?? '#888',
                    transformTier,
                };
            }
            // Other members — approximate stats by level (we don't have their live stats locally).
            const hp = Math.max(100, m.level * 60);
            const mp = Math.max(40, m.level * 30);
            return {
                id: m.id,
                name: m.name,
                class: m.class,
                level: m.level,
                maxHp: hp,
                hp,
                maxMp: mp,
                mp,
                attack: 5 + m.level * 3,
                defense: 2 + m.level * 1,
                isDead: false,
                isBot: !!m.isBot,
                hasEscaped: false,
                color: CLASS_COLORS[m.class] ?? '#888',
                transformTier: 0,
            };
        });
    }, [character, party]);

    // ── Start raid ──────────────────────────────────────────────────────────
    const startRaid = useCallback((raid: IRaid) => {
        if (!consumeAttempt(raid.id)) {
            addLog('Brak dostępnych prób dzisiaj dla tego rajdu.');
            return;
        }
        setSelectedRaid(raid);
        setCurrentWave(0);
        const waveBosses = generateWaveBosses(raid, 0);
        setBosses(waveBosses);
        const newMembers = buildMemberStates();
        setMembers(newMembers);
        cooldownsRef.current = {};
        setLogLines([`⚔️ Rajd "${raid.name_pl}" rozpoczęty! Fala 1/${raid.waves}`]);
        setDropsByMember({});
        setPhase('fighting');
    }, [buildMemberStates, consumeAttempt, addLog]);

    // ── Combat tick loop ─────────────────────────────────────────────────────
    useEffect(() => {
        if (phase !== 'fighting') return;
        const interval = setInterval(() => {
            tickIdRef.current += 1;
            const tick = tickIdRef.current;

            // Members act
            const curMembers = membersRef.current;
            const curBosses = bossesRef.current;
            const aliveBosses = curBosses.filter((b) => !b.isDead);
            if (aliveBosses.length === 0 || curMembers.every((m) => m.isDead || m.hasEscaped)) return;

            const nextMembers = [...curMembers];
            const nextBosses = curBosses.map((b) => ({ ...b }));
            const fxQueue: ISkillFx[] = [];

            for (let mi = 0; mi < nextMembers.length; mi++) {
                const mem = nextMembers[mi];
                if (mem.isDead || mem.hasEscaped) continue;

                // Basic attack every 2 ticks (≈1s at X1).
                if (tick % 2 === 0) {
                    const target = nextBosses.find((b) => !b.isDead);
                    if (target) {
                        const dmg = Math.max(1, mem.attack - Math.floor(target.defense * 0.5));
                        target.currentHp = Math.max(0, target.currentHp - dmg);
                        if (target.currentHp <= 0) target.isDead = true;
                        if (mem.id === character?.id) {
                            addLog(`⚔️ Zadajesz ${dmg} obrażeń (${target.name})`);
                        }
                    }
                }

                // Skill every ~16 ticks (8s at X1). Pick first affordable & off-cooldown.
                if (tick % 16 === 0) {
                    const skills = getClassActiveSkills(mem.class)
                        .filter((s) => s.unlockLevel <= mem.level && s.damage > 0);
                    const memCds = cooldownsRef.current[mem.id] ?? {};
                    const chosen = skills
                        .sort((a, b) => b.unlockLevel - a.unlockLevel)
                        .find((s) => mem.mp >= s.mpCost && (memCds[s.id] ?? 0) <= tick);
                    if (chosen) {
                        mem.mp = Math.max(0, mem.mp - chosen.mpCost);
                        cooldownsRef.current[mem.id] = {
                            ...memCds,
                            [chosen.id]: tick + Math.ceil(chosen.cooldown / 500),
                        };
                        const aoe = isAoeSkill(chosen.effect);
                        const targets = aoe
                            ? nextBosses.map((b, i) => (b.isDead ? -1 : i)).filter((i) => i >= 0)
                            : (() => {
                                const first = nextBosses.findIndex((b) => !b.isDead);
                                return first >= 0 ? [first] : [];
                            })();
                        const baseDmg = Math.floor(mem.attack * chosen.damage);
                        for (const ti of targets) {
                            const t = nextBosses[ti];
                            if (!t || t.isDead) continue;
                            const dmg = Math.max(1, baseDmg - Math.floor(t.defense * 0.3));
                            t.currentHp = Math.max(0, t.currentHp - dmg);
                            if (t.currentHp <= 0) t.isDead = true;
                        }
                        fxQueue.push({
                            id: fxIdRef.current++,
                            skillId: chosen.id,
                            targets,
                            expiresAt: Date.now() + 900,
                        });
                        if (mem.id === character?.id) {
                            addLog(`✨ Używasz ${chosen.id} (${aoe ? 'AOE' : 'single'})`);
                        }
                    }
                }
            }

            // Bosses act every 3 ticks (≈1.5s at X1)
            if (tick % 3 === 0) {
                for (const boss of nextBosses) {
                    if (boss.isDead) continue;
                    const liveTargets = nextMembers.filter((m) => !m.isDead && !m.hasEscaped);
                    if (liveTargets.length === 0) break;
                    const tgt = liveTargets[Math.floor(Math.random() * liveTargets.length)];
                    const dmg = Math.max(1, boss.attack - Math.floor(tgt.defense * 0.4));
                    tgt.hp = Math.max(0, tgt.hp - dmg);
                    if (tgt.hp <= 0) {
                        tgt.isDead = true;
                        addLog(`💀 ${tgt.name} pada!`);
                    }
                }
            }

            setBosses(nextBosses);
            setMembers(nextMembers);
            if (fxQueue.length > 0) setSkillFx((prev) => [...prev, ...fxQueue]);

            // Sync my character HP/MP back to the store so UI reflects it.
            const me = nextMembers.find((m) => m.id === character?.id);
            if (me) {
                useCharacterStore.getState().updateCharacter({ hp: me.hp, mp: me.mp });
            }

            // Wave / raid end checks
            if (nextBosses.every((b) => b.isDead)) {
                const nextWaveIdx = currentWave + 1;
                if (selectedRaid && nextWaveIdx < selectedRaid.waves) {
                    setCurrentWave(nextWaveIdx);
                    setBosses(generateWaveBosses(selectedRaid, nextWaveIdx));
                    addLog(`✓ Fala ${nextWaveIdx}/${selectedRaid.waves} zaliczona!`);
                } else if (selectedRaid) {
                    setPhase('victory');
                    distributeRewards(selectedRaid, nextMembers);
                }
            }

            if (nextMembers.every((m) => m.isDead || m.hasEscaped)) {
                setPhase('wipe');
                handleWipe();
            }
        }, Math.max(100, 500 / speedMult));

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, speedMult, selectedRaid, currentWave, character?.id]);

    // Prune expired skill FX
    useEffect(() => {
        if (skillFx.length === 0) return;
        const t = setTimeout(() => {
            setSkillFx((prev) => prev.filter((f) => f.expiresAt > Date.now()));
        }, 400);
        return () => clearTimeout(t);
    }, [skillFx]);

    // ── Wipe / death penalty ────────────────────────────────────────────────
    const handleWipe = useCallback(() => {
        const char = useCharacterStore.getState().character;
        if (!char) return;
        const p = applyDeathPenalty(char.level, char.xp);
        useCharacterStore.getState().updateCharacter({
            level: p.newLevel,
            xp: p.newXp,
            hp: 1,
            mp: 0,
        });
        addLog(`💀 Wipe! Kara: -${p.levelsLost} lvl, XP zresetowane do ${p.xpPercent}%`);
    }, [addLog]);

    // ── Rewards ─────────────────────────────────────────────────────────────
    const distributeRewards = useCallback((raid: IRaid, finalMembers: IRaidMemberState[]) => {
        const bossesDefeatedPerMember = raid.waves * 4;
        const perMember: Record<string, IRaidDropLine[]> = {};

        for (const mem of finalMembers) {
            if (mem.hasEscaped) continue;
            const result = rollMemberRewards({
                member: mem,
                raid,
                bossesDefeated: bossesDefeatedPerMember,
            });
            perMember[mem.id] = result.drops;

            // Apply to the local character only (other members get their share server-side
            // in a full realtime setup — we simulate locally so only "me" actually gains).
            if (character && mem.id === character.id) {
                useCharacterStore.getState().addXp(result.xp);
                const inv = useInventoryStore.getState();
                useCharacterStore.getState().updateCharacter({
                    gold: (character.gold ?? 0) + result.gold,
                });
                for (const it of result.items) inv.addItem(it);
                for (const drop of result.drops) {
                    if (drop.kind === 'spell_chest' && drop.amount) {
                        inv.addSpellChest(drop.amount, 1);
                    }
                }
            }
        }
        setDropsByMember(perMember);
        addLog('🏆 Rajd ukończony! Nagrody rozdzielone.');
    }, [character, addLog]);

    // ── Escape handler ──────────────────────────────────────────────────────
    const handleEscape = useCallback(async () => {
        if (!character) return;
        setMembers((prev) =>
            prev.map((m) => (m.id === character.id ? { ...m, hasEscaped: true } : m)),
        );
        addLog('🏳️ Uciekasz z rajdu! Party opuszczone.');
        try { await leaveParty(character.id); } catch { /* best effort */ }
        // Death penalty for abandoning
        const p = applyDeathPenalty(character.level, character.xp);
        useCharacterStore.getState().updateCharacter({
            level: p.newLevel, xp: p.newXp, hp: 1, mp: 0,
        });
        // Cancel any background combat
        useCharacterStore.getState();
        setPhase('lobby');
        setSelectedRaid(null);
        navigate('/');
    }, [character, leaveParty, addLog, navigate]);

    const backToLobby = useCallback(() => {
        setPhase('lobby');
        setSelectedRaid(null);
        setBosses([]);
        setMembers([]);
        setSkillFx([]);
        setDropsByMember({});
    }, []);

    // ── Render: lobby gate ──────────────────────────────────────────────────
    if (phase === 'lobby') {
        const noParty = !party;
        const partyTooSmall = party && totalMembers < 2;
        const notLeader = party && !iAmLeader;
        return (
            <div className="raid">
                <div className="raid__header">
                    <button className="raid__back-btn" onClick={() => navigate('/')}>← Miasto</button>
                    <h1>⚔️ Raidy Party</h1>
                </div>

                {noParty && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon">🔒</span>
                        <h2>Potrzebujesz Party</h2>
                        <p>Raidy wymagają co najmniej 2 graczy w party. Dołącz lub załóż party.</p>
                        <button onClick={() => navigate('/party')}>Przejdź do Party</button>
                    </div>
                )}

                {partyTooSmall && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon">👥</span>
                        <h2>Za mało osób</h2>
                        <p>Party musi mieć co najmniej 2 osoby ({humanMembers.length}/2). Dodaj członka lub bota.</p>
                        <button onClick={() => navigate('/party')}>Party</button>
                    </div>
                )}

                {notLeader && (
                    <div className="raid__gate">
                        <span className="raid__gate-icon">👑</span>
                        <h2>Tylko lider</h2>
                        <p>Rajd wybiera i startuje lider party.</p>
                    </div>
                )}

                {party && totalMembers >= 2 && iAmLeader && (
                    <>
                        <p className="raid__hint">
                            Limit rajdu: lvl {partyMinLevel} (najniższy lvl w party). Każdy raid 3×/dzień.
                        </p>
                        <div className="raid__list">
                            {raids.map((r) => {
                                const locked = r.level > partyMinLevel;
                                const left = attemptsRemaining(r.id);
                                return (
                                    <button
                                        key={r.id}
                                        className={`raid__card${locked ? ' raid__card--locked' : ''}${left === 0 ? ' raid__card--done' : ''}`}
                                        onClick={() => !locked && left > 0 && startRaid(r)}
                                        disabled={locked || left === 0}
                                    >
                                        <span className="raid__card-lvl">Lvl {r.level}</span>
                                        <span className="raid__card-name">{r.name_pl}</span>
                                        <span className="raid__card-waves">{r.waves} {r.waves === 1 ? 'fala' : 'fal'} × 4 bossy</span>
                                        <span className="raid__card-left">{left}/{r.dailyAttempts}</span>
                                        {locked && <span className="raid__card-lock">🔒</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        );
    }

    // ── Render: victory / wipe ──────────────────────────────────────────────
    if (phase === 'victory' || phase === 'wipe') {
        return (
            <div className="raid">
                <div className="raid__header">
                    <h1>{phase === 'victory' ? '🏆 Zwycięstwo' : '💀 Porażka'}</h1>
                </div>
                <div className="raid__result">
                    {phase === 'victory' && members.map((m) => (
                        <div key={m.id} className="raid__result-member" style={{ borderColor: m.color }}>
                            <h3>{m.name} ({m.class})</h3>
                            <ul>
                                {(dropsByMember[m.id] ?? []).map((d, i) => (
                                    <li key={i} className={`raid__drop raid__drop--${d.rarity ?? 'common'}`}>
                                        {d.label}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {phase === 'wipe' && (
                        <p>Cała drużyna padła. Zastosowano karę śmierci.</p>
                    )}
                    <button className="raid__primary" onClick={backToLobby}>Powrót do lobby</button>
                </div>
            </div>
        );
    }

    // ── Render: fighting ────────────────────────────────────────────────────
    return (
        <div className="raid raid--fighting">
            <div className="raid__topbar">
                <div>
                    <strong>{selectedRaid?.name_pl}</strong> · Fala {currentWave + 1}/{selectedRaid?.waves}
                </div>
                <div className="raid__speed">
                    {SPEED_OPTIONS.map((s) => (
                        <button
                            key={s.label}
                            className={speedMult === s.mult ? 'is-active' : ''}
                            onClick={() => setSpeedMult(s.mult)}
                        >{s.label}</button>
                    ))}
                </div>
                <button className="raid__escape" onClick={handleEscape}>🏳️ Ucieczka</button>
            </div>

            <div className="raid__arena">
                <div className="raid__members">
                    {members.map((m) => (
                        <div
                            key={m.id}
                            className={`raid__member${m.isDead ? ' is-dead' : ''}${m.hasEscaped ? ' is-escaped' : ''}`}
                            style={{ borderColor: m.color }}
                        >
                            <div className="raid__member-head">
                                <span className="raid__member-name">{m.name}</span>
                                <span className="raid__member-class" style={{ color: m.color }}>{m.class} · lvl {m.level}</span>
                                {m.transformTier > 0 && <span className="raid__member-tier">T{m.transformTier}</span>}
                                {m.isBot && <span className="raid__member-bot">🤖</span>}
                            </div>
                            <div className="raid__bar raid__bar--hp">
                                <div style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
                                <span>{m.hp} / {m.maxHp}</span>
                            </div>
                            <div className="raid__bar raid__bar--mp">
                                <div style={{ width: `${(m.mp / Math.max(1, m.maxMp)) * 100}%` }} />
                                <span>{m.mp} / {m.maxMp}</span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="raid__bosses">
                    {bosses.map((b, i) => {
                        const fxForSlot = skillFx.filter((f) => f.targets.includes(i));
                        return (
                            <div key={b.id} className={`raid__boss${b.isDead ? ' is-dead' : ''}`}>
                                <div className="raid__boss-head">
                                    <span className="raid__boss-sprite">{b.sprite}</span>
                                    <span className="raid__boss-name">{b.name}</span>
                                </div>
                                <div className="raid__bar raid__bar--hp">
                                    <div style={{ width: `${(b.currentHp / b.maxHp) * 100}%` }} />
                                    <span>{b.currentHp.toLocaleString('pl-PL')} / {b.maxHp.toLocaleString('pl-PL')}</span>
                                </div>
                                {fxForSlot.map((fx) => {
                                    const anim = getSkillAnimation(fx.skillId);
                                    if (!anim) return null;
                                    return (
                                        <div
                                            key={fx.id}
                                            className={`raid__fx ${anim.cssClass}`}
                                            style={{ color: anim.color }}
                                        >{anim.emoji}</div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="raid__log">
                {logLines.slice(-8).map((l, i) => (
                    <div key={i}>{l}</div>
                ))}
            </div>
        </div>
    );
};

export default Raid;
