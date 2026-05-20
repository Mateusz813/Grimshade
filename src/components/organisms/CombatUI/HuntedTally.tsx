import { useCombatStore } from '../../../stores/combatStore';

/**
 * "Upolowano:" strip — hunting-only widget that shows one rarity-tinted
 * monster icon per rarity tier with a kill counter beside it. Higher
 * rarities count more toward task/quest progress; the spec asks us to
 * surface the breakdown so the player can see how their loot is shaped.
 */
const RARITY_TIERS: Array<{ id: string; emoji: string; label: string }> = [
    { id: 'normal',    emoji: '👹', label: 'Zwykły' },
    { id: 'strong',    emoji: '👺', label: 'Silny' },
    { id: 'epic',      emoji: '👻', label: 'Epicki' },
    { id: 'legendary', emoji: '💀', label: 'Legendarny' },
    { id: 'boss',      emoji: '🐲', label: 'Boss' },
];

const HuntedTally = () => {
    const sessionKills = useCombatStore((s) => s.sessionKills);

    return (
        <div className="combat-ui__hunted">
            <div className="combat-ui__hunted-row">
                {RARITY_TIERS.map((t) => (
                    <div
                        key={t.id}
                        className={`combat-ui__hunted-cell combat-ui__hunted-cell--${t.id}`}
                        title={t.label}
                    >
                        <span className="combat-ui__hunted-icon">{t.emoji}</span>
                        <span className="combat-ui__hunted-count">{sessionKills[t.id] ?? 0}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HuntedTally;
