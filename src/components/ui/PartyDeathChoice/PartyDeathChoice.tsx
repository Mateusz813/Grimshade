import GameIcon from '../../atoms/Twemoji/GameIcon';
import EmojiText from '../../atoms/Twemoji/EmojiText';
import './PartyDeathChoice.scss';

interface IPartyDeathChoiceProps {
    open: boolean;
    aliveAllies: number;
    onReturnToTown: () => void;
    onWaitForResurrection: () => void;
}

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
