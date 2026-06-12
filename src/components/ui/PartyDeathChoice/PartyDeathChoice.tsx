import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import './PartyDeathChoice.scss';

interface IPartyDeathChoiceProps {
    /** Controls visibility — when false the popup unmounts so the in-animation
     *  replays cleanly the next time the player dies in a party fight. */
    open: boolean;
    /** Number of party members still alive (informational — drives the
     *  resurrection-chance copy below the button so the player can read at a
     *  glance whether waiting is realistic). 0 means the popup shouldn't
     *  even be open (no one left to revive you), but the component renders
     *  defensively and just hides the chance hint. */
    aliveAllies: number;
    /** Player chose to bail. Caller applies the full death penalty + nav. */
    onReturnToTown: () => void;
    /** Player chose to wait for an ally to revive them. Caller closes the
     *  popup and flips the "waiting for resurrection" flag in raid state.
     *  If no ally revives them and the party eventually wipes, the standard
     *  wipe-penalty path applies — the choice itself never triggers a
     *  penalty, so there's no double-charge. */
    onWaitForResurrection: () => void;
}

/**
 * Mid-fight choice popup that fires when the player dies in a party combat
 * (raid) WHILE other allies are still up. Solo death (or party-wipe death,
 * which is the same fight-ending event) routes through the global
 * DeathNotification instead — this popup only handles the "you went down
 * but the team is still swinging" case.
 *
 * Two outcomes:
 *   - Powrót do miasta — apply full death penalty NOW, leave the raid.
 *   - Czekaj na wskrzeszenie — stay slumped on the field. While dead the
 *     raid loop rolls a small revive chance per tick; if any ally rezzes
 *     you, you rejoin at half HP/MP. If the party then wipes anyway, the
 *     wipe penalty fires (and that's the ONLY penalty — the wait choice
 *     itself never charges anything, by design).
 */
const PartyDeathChoice = ({
    open,
    aliveAllies,
    onReturnToTown,
    onWaitForResurrection,
}: IPartyDeathChoiceProps) => {
    if (!open) return null;

    return (
        <div className="party-death-choice">
            <div className="party-death-choice__panel">
                <div className="party-death-choice__icon"><GameIcon name="skull" /></div>
                <h2 className="party-death-choice__title">Padłeś!</h2>
                <p className="party-death-choice__subtitle">
                    Twoja drużyna wciąż walczy ({aliveAllies} sojusznik{aliveAllies === 1 ? '' : aliveAllies < 5 ? 'ów' : 'ów'} przy życiu).
                </p>
                <p className="party-death-choice__hint">
                    Możesz wrócić do miasta i ponieść karę śmierci, albo
                    poczekać aż sojusznik Cię wskrzesi. Jeśli Cię nie
                    wskrzeszą i drużyna padnie — kara śmierci naliczy się
                    raz (nie podwójnie).
                </p>
                <div className="party-death-choice__actions">
                    <button
                        type="button"
                        className="party-death-choice__btn party-death-choice__btn--town"
                        onClick={onReturnToTown}
                    >
                        <EmojiText>:castle: Powrót do miasta</EmojiText>
                    </button>
                    <button
                        type="button"
                        className="party-death-choice__btn party-death-choice__btn--wait"
                        onClick={onWaitForResurrection}
                        disabled={aliveAllies === 0}
                        title={aliveAllies === 0 ? 'Brak żywych sojuszników' : 'Czekaj na wskrzeszenie'}
                    >
                        <GameIcon name="hourglass-not-done" /> Czekaj na wskrzeszenie
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PartyDeathChoice;
