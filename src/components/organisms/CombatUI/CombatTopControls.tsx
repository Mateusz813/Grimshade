import type { TSlotNode } from './types';
import Icon from '../../atoms/Icon/Icon';
import GameIcon from '../../atoms/Twemoji/GameIcon';

interface IProps {
    speed?: { label: string; onCycle: () => void; disabled?: boolean } | null;
    autoSkill?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    autoFight?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    xpVisible?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    autoPotion?: { on: boolean; onToggle: () => void; disabled?: boolean } | null;
    extras?: TSlotNode;
}

const CombatTopControls = ({ speed, autoSkill, autoFight, xpVisible, autoPotion, extras }: IProps) => {
    const disabledStyle: React.CSSProperties = { opacity: 0.45, cursor: 'not-allowed' };
    return (
        <div className="combat-ui__top-controls" role="group" aria-label="Ustawienia walki">
            {speed && (
                <button
                    type="button"
                    className="combat-ui__chip"
                    onClick={speed.disabled ? undefined : speed.onCycle}
                    aria-disabled={speed.disabled || undefined}
                    style={speed.disabled ? disabledStyle : undefined}
                    title={speed.disabled ? 'Tylko lider party może zmieniać ten parametr' : 'Prędkość walki'}
                >
                    <GameIcon name="fast-forward-button" /> <strong>{speed.label}</strong>
                </button>
            )}
            {autoSkill && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoSkill.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoSkill.disabled ? undefined : autoSkill.onToggle}
                    aria-disabled={autoSkill.disabled || undefined}
                    style={autoSkill.disabled ? disabledStyle : undefined}
                    title="Auto skille"
                >
                    <GameIcon name="sparkles" /> {autoSkill.on ? 'ON' : 'OFF'}
                </button>
            )}
            {autoFight && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoFight.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoFight.disabled ? undefined : autoFight.onToggle}
                    aria-disabled={autoFight.disabled || undefined}
                    style={autoFight.disabled ? disabledStyle : undefined}
                    title="Auto walka"
                >
                    <GameIcon name="crossed-swords" /> {autoFight.on ? 'ON' : 'OFF'}
                </button>
            )}
            {autoPotion && (
                <button
                    type="button"
                    className={`combat-ui__chip${autoPotion.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={autoPotion.disabled ? undefined : autoPotion.onToggle}
                    aria-disabled={autoPotion.disabled || undefined}
                    style={autoPotion.disabled ? disabledStyle : undefined}
                    title="Auto potion"
                >
                    <GameIcon name="test-tube" /> {autoPotion.on ? 'ON' : 'OFF'}
                </button>
            )}
            {xpVisible && (
                <button
                    type="button"
                    className={`combat-ui__chip${xpVisible.on ? ' combat-ui__chip--on' : ''}`}
                    onClick={xpVisible.disabled ? undefined : xpVisible.onToggle}
                    aria-disabled={xpVisible.disabled || undefined}
                    style={xpVisible.disabled ? disabledStyle : undefined}
                    title="Pokaż pasek XP"
                >
                    <Icon name={xpVisible.on ? 'eye' : 'eyeOff'} />
                </button>
            )}
            {extras}
        </div>
    );
};

export default CombatTopControls;
