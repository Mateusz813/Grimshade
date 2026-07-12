import type { ICombatSkillSlot, TExitConfig } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import Icon from '../../atoms/Icon/Icon';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';

interface IProps {
    skills: Array<ICombatSkillSlot | null>;
    exit: TExitConfig;
}

const SkillButton = ({ s }: { s: ICombatSkillSlot | null }) => {
    if (!s) return <button type="button" className="combat-ui__action-btn combat-ui__action-btn--empty" aria-hidden="true" />;
    const cls = [
        'combat-ui__action-btn',
        'combat-ui__action-btn--skill',
        s.disabled ? 'combat-ui__action-btn--disabled' : '',
        s.cooldownProgress < 1 ? 'combat-ui__action-btn--cooldown' : '',
    ].filter(Boolean).join(' ');
    return (
        <button type="button" className={cls} onClick={s.onClick} disabled={s.disabled} title={s.name} aria-label={s.name}>
            {isImageUrl(s.icon) ? (
                <img className="combat-ui__action-skill-img" src={s.icon} alt="" draggable={false} />
            ) : (
                <span className="combat-ui__action-icon"><TinyIcon icon={s.icon} /></span>
            )}
            {s.mpCost > 0 && (
                <span className="combat-ui__action-mp">{s.mpCost}</span>
            )}
            {s.cooldownProgress < 1 && (
                <>
                    <span className="combat-ui__action-cd" style={{ height: `${(1 - s.cooldownProgress) * 100}%` }} />
                    {typeof s.cooldownRemainingMs === 'number' && s.cooldownRemainingMs > 0 && (
                        <span className="combat-ui__action-cd-text">
                            {s.cooldownRemainingMs >= 1000
                                ? `${Math.ceil(s.cooldownRemainingMs / 1000)}s`
                                : `${(s.cooldownRemainingMs / 1000).toFixed(1)}s`}
                        </span>
                    )}
                </>
            )}
        </button>
    );
};

const CombatActionBar = ({ skills, exit }: IProps) => {
    const padSkills: Array<ICombatSkillSlot | null> = [...skills.slice(0, 4)];
    while (padSkills.length < 4) padSkills.push(null);

    const exitOnClick = exit.kind === 'hunt-popup' ? exit.onOpenDialog : exit.onFlee;

    return (
        <nav className="combat-ui__action-bar" aria-label="Akcje walki">
            {padSkills.map((s, i) => (
                <SkillButton key={s?.id ?? `skill-empty-${i}`} s={s} />
            ))}
            <button
                type="button"
                className="combat-ui__action-btn combat-ui__action-btn--exit"
                onClick={exitOnClick}
                aria-label={exit.kind === 'hunt-popup' ? 'Wyjdź' : 'Ucieknij'}
                title={exit.kind === 'hunt-popup' ? 'Wyjdź' : 'Ucieknij'}
            >
                <span className="combat-ui__action-icon"><Icon name="arrowLeft" /></span>
            </button>
        </nav>
    );
};

export default CombatActionBar;
