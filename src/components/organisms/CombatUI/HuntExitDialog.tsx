interface IProps {
    onEndHunt: () => void;
    onLeaveBackground: () => void;
    onClose: () => void;
}

const HuntExitDialog = ({ onEndHunt, onLeaveBackground, onClose }: IProps) => {
    return (
        <div className="combat-ui__modal-bg" onClick={onClose}>
            <div className="combat-ui__modal combat-ui__modal--exit" onClick={(e) => e.stopPropagation()}>
                <header className="combat-ui__modal-head">
                    <span className="combat-ui__modal-title">Co chcesz zrobić?</span>
                    <button type="button" className="combat-ui__modal-close" onClick={onClose} aria-label="Zamknij">×</button>
                </header>

                <p className="combat-ui__modal-body">
                    Możesz zakończyć polowanie i wrócić do miasta — albo zostawić walkę w tle i samemu wrócić.
                </p>

                <div className="combat-ui__modal-actions">
                    <button type="button" className="combat-ui__modal-btn combat-ui__modal-btn--danger" onClick={onEndHunt}>
                        Zakończ polowanie
                    </button>
                    <button type="button" className="combat-ui__modal-btn combat-ui__modal-btn--primary" onClick={onLeaveBackground}>
                        Wróć do miasta
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HuntExitDialog;
