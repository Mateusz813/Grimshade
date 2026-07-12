import { useCombatStore } from '../../../stores/combatStore';
import GameIcon from '../../atoms/Twemoji/GameIcon';

const RARITY_TIERS: Array<{ id: string; emoji: string; label: string }> = [
    { id: 'normal',    emoji: 'ogre', label: 'Zwykły' },
    { id: 'strong',    emoji: 'goblin', label: 'Silny' },
    { id: 'epic',      emoji: 'ghost', label: 'Epicki' },
    { id: 'legendary', emoji: 'skull', label: 'Legendarny' },
    { id: 'boss',      emoji: 'dragon-face', label: 'Boss' },
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
                        <span className="combat-ui__hunted-icon"><GameIcon name={t.emoji} /></span>
                        <span className="combat-ui__hunted-count">{sessionKills[t.id] ?? 0}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default HuntedTally;
