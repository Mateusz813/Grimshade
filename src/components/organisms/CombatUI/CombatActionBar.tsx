import type { ICombatSkillSlot, TExitConfig } from './types';
import { isImageUrl } from '../../../systems/spriteAssets';
import Icon from '../../atoms/Icon/Icon';
import TinyIcon from '../../ui/TinyIcon/TinyIcon';

interface IProps {
    /** 4 active skill slots — pad with `null` for empty placeholders. */
    skills: Array<ICombatSkillSlot | null>;
    /** Exit config — hunting popup OR straight flee with penalty. Both render
     *  as the same red icon-only button; the kind only changes the click
     *  handler under the hood. */
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
                    {/* Numeric remaining timer overlay — pinned dead-centre so
                        the player can read it through the dim sweep. Hides
                        the MP / count badges visually because the sweep
                        already covers them. */}
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

/**
 * Bottom action bar — fixed at the bottom of the viewport, replaces the
 * global BottomNav while a fight is active. Layout:
 *
 *   [Skill1] [Skill2] [Skill3] [Skill4] [<- exit]
 *
 * Potions live separately in the floating <CombatPotionDock /> so they
 * stay reachable on every screen size without competing with the skill
 * row for horizontal space. Exit is a single red icon-only circle (no
 * text) — both hunt-popup and flee modes look identical, only the click
 * handler differs.
 */
const CombatActionBar = ({ skills, exit }: IProps) => {
    // Pad skills to length 4
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
