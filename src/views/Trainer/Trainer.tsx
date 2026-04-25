import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCharacterStore } from '../../stores/characterStore';
import { usePartyStore } from '../../stores/partyStore';
import { getSkillAnimation } from '../../data/skillAnimations';
import skillsData from '../../data/skills.json';
import './Trainer.scss';

const CLASS_COLORS: Record<string, string> = {
    Knight: '#e53935', Mage: '#7b1fa2', Cleric: '#ffc107', Archer: '#4caf50',
    Rogue: '#424242', Necromancer: '#795548', Bard: '#ff9800',
};

const SPEED_OPTIONS = [1, 2, 3, 4];
const DUMMY_MAX_HP = 999_999_999;
const BEST_WINDOW_MS = 5000;

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

interface IFx { id: number; skillId: string; expiresAt: number; }

const Trainer = () => {
    const navigate = useNavigate();
    const character = useCharacterStore((s) => s.character);
    const party = usePartyStore((s) => s.party);
    const [speedMult, setSpeedMult] = useState(1);
    const [autoPotion, setAutoPotion] = useState(true);
    const [autoSkill, setAutoSkill] = useState(true);
    const [autoBasic, setAutoBasic] = useState(true);
    const [trainerAttacks, setTrainerAttacks] = useState(false);
    const [dummyHp, setDummyHp] = useState(DUMMY_MAX_HP);
    const [totalDmg, setTotalDmg] = useState(0);
    const [best5s, setBest5s] = useState(0);
    const [cur5s, setCur5s] = useState(0);
    const [fx, setFx] = useState<IFx[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const tickRef = useRef(0);
    const cooldownsRef = useRef<Record<string, number>>({});
    const windowEventsRef = useRef<Array<{ at: number; dmg: number }>>([]);
    const fxIdRef = useRef(0);

    const myAttack = character?.attack ?? 10;
    const myColor = character ? CLASS_COLORS[character.class] ?? '#888' : '#888';

    const addLog = useCallback((t: string) => {
        setLogs((prev) => [...prev.slice(-40), t]);
    }, []);

    const pushDamage = useCallback((dmg: number) => {
        setTotalDmg((v) => v + dmg);
        const now = Date.now();
        windowEventsRef.current.push({ at: now, dmg });
        // Prune events outside 5s window
        windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= BEST_WINDOW_MS);
        const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
        setCur5s(cur);
        setBest5s((prev) => Math.max(prev, cur));
    }, []);

    // Dummy hp resets to full after each hit.
    const hitDummy = useCallback((dmg: number, skillId?: string) => {
        setDummyHp(DUMMY_MAX_HP); // stays full visually — invincible
        pushDamage(dmg);
        if (skillId) {
            setFx((prev) => [...prev, { id: fxIdRef.current++, skillId, expiresAt: Date.now() + 800 }]);
        }
    }, [pushDamage]);

    // Combat tick
    useEffect(() => {
        if (!character) return;
        const interval = setInterval(() => {
            tickRef.current += 1;
            const tick = tickRef.current;

            // Basic attack every 2 ticks
            if (autoBasic && tick % 2 === 0) {
                const dmg = Math.max(1, myAttack);
                hitDummy(dmg);
                addLog(`⚔️ ${dmg} dmg`);
            }

            // Skill every 16 ticks (~8s at X1)
            if (autoSkill && tick % 16 === 0) {
                const skills = getClassActiveSkills(character.class)
                    .filter((s) => s.unlockLevel <= character.level && s.damage > 0);
                const ready = skills
                    .sort((a, b) => b.unlockLevel - a.unlockLevel)
                    .find((s) => (cooldownsRef.current[s.id] ?? 0) <= tick);
                if (ready) {
                    cooldownsRef.current[ready.id] = tick + Math.ceil(ready.cooldown / 500);
                    const dmg = Math.floor(myAttack * ready.damage);
                    hitDummy(dmg, ready.id);
                    addLog(`✨ ${ready.id}: ${dmg} dmg`);
                }
            }

            // Trainer attacks player at 1 HP if enabled
            if (trainerAttacks && tick % 4 === 0) {
                useCharacterStore.getState().updateCharacter({ hp: 1 });
                addLog('🎯 Trainer atakuje — HP do 1');
            }

            // Update 5s window
            const now = Date.now();
            windowEventsRef.current = windowEventsRef.current.filter((e) => now - e.at <= BEST_WINDOW_MS);
            const cur = windowEventsRef.current.reduce((s, e) => s + e.dmg, 0);
            setCur5s(cur);
        }, Math.max(100, 500 / speedMult));
        return () => clearInterval(interval);
    }, [character, speedMult, autoBasic, autoSkill, trainerAttacks, myAttack, hitDummy, addLog]);

    // Prune fx
    useEffect(() => {
        if (fx.length === 0) return;
        const t = setTimeout(() => {
            setFx((prev) => prev.filter((f) => f.expiresAt > Date.now()));
        }, 300);
        return () => clearTimeout(t);
    }, [fx]);

    // Auto-potion — restore HP/MP when below 50%
    useEffect(() => {
        if (!autoPotion || !character) return;
        if (character.hp < character.max_hp * 0.5 || character.mp < character.max_mp * 0.5) {
            useCharacterStore.getState().updateCharacter({
                hp: character.max_hp, mp: character.max_mp,
            });
        }
    }, [autoPotion, character]);

    const partyList = useMemo(() => party?.members ?? [], [party]);

    const resetSession = () => {
        setTotalDmg(0); setBest5s(0); setCur5s(0);
        windowEventsRef.current = [];
        addLog('🔄 Sesja zresetowana');
    };

    if (!character) return <div className="trainer">Wczytywanie postaci…</div>;

    return (
        <div className="trainer">
            <div className="trainer__header">
                <button onClick={() => navigate('/')}>← Miasto</button>
                <h1>🎯 Trainer</h1>
                <button onClick={resetSession}>Reset</button>
            </div>

            <div className="trainer__controls">
                <div className="trainer__speed">
                    {SPEED_OPTIONS.map((n) => (
                        <button key={n} className={speedMult === n ? 'is-active' : ''} onClick={() => setSpeedMult(n)}>X{n}</button>
                    ))}
                </div>
                <label><input type="checkbox" checked={autoBasic} onChange={(e) => setAutoBasic(e.target.checked)} /> Auto-atak</label>
                <label><input type="checkbox" checked={autoSkill} onChange={(e) => setAutoSkill(e.target.checked)} /> Auto-skill</label>
                <label><input type="checkbox" checked={autoPotion} onChange={(e) => setAutoPotion(e.target.checked)} /> Auto-potion</label>
                <label><input type="checkbox" checked={trainerAttacks} onChange={(e) => setTrainerAttacks(e.target.checked)} /> Trainer oddaje (do 1 HP)</label>
            </div>

            <div className="trainer__arena">
                <div className="trainer__player" style={{ borderColor: myColor }}>
                    <h3>{character.name}</h3>
                    <div className="trainer__class" style={{ color: myColor }}>{character.class} · lvl {character.level}</div>
                    <div className="trainer__bar trainer__bar--hp">
                        <div style={{ width: `${(character.hp / character.max_hp) * 100}%` }} />
                        <span>{character.hp}/{character.max_hp}</span>
                    </div>
                    <div className="trainer__bar trainer__bar--mp">
                        <div style={{ width: `${(character.mp / character.max_mp) * 100}%` }} />
                        <span>{character.mp}/{character.max_mp}</span>
                    </div>
                    {partyList.filter((m) => m.id !== character.id).map((m) => (
                        <div key={m.id} className="trainer__party-member">
                            🤝 {m.name} ({m.class} lvl {m.level})
                        </div>
                    ))}
                </div>

                <div className="trainer__dummy">
                    <div className="trainer__dummy-sprite">🎯</div>
                    <div className="trainer__dummy-name">Trening Dummy (niezniszczalny)</div>
                    <div className="trainer__bar trainer__bar--hp">
                        <div style={{ width: `${(dummyHp / DUMMY_MAX_HP) * 100}%` }} />
                        <span>∞</span>
                    </div>
                    {fx.map((f) => {
                        const anim = getSkillAnimation(f.skillId);
                        if (!anim) return null;
                        return <div key={f.id} className={`trainer__fx ${anim.cssClass}`} style={{ color: anim.color }}>{anim.emoji}</div>;
                    })}
                </div>
            </div>

            <div className="trainer__stats">
                <div><span>Całkowite obrażenia:</span> <strong>{totalDmg.toLocaleString('pl-PL')}</strong></div>
                <div><span>Ostatnie 5s:</span> <strong>{cur5s.toLocaleString('pl-PL')}</strong></div>
                <div><span>Best 5s:</span> <strong style={{ color: '#ffc107' }}>{best5s.toLocaleString('pl-PL')}</strong></div>
            </div>

            <div className="trainer__log">
                {logs.slice(-8).map((l, i) => <div key={i}>{l}</div>)}
            </div>
        </div>
    );
};

export default Trainer;
