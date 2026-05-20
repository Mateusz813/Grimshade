import './Spinner.scss';

interface IProps {
    /** Optional caption rendered under the spinner. Defaults to "Ładowanie..." */
    label?: string;
    /** Spinner size. `md` (default) is the all-purpose 36-px ring; `sm` is
     *  the inline 18-px loader for buttons; `lg` is the full-page 56-px
     *  ring used by route-level "loading character" placeholders. */
    size?: 'sm' | 'md' | 'lg';
    /** Hide the caption text — used when the parent already renders its
     *  own copy (e.g. "Wybierz" buttons in mid-loading state). */
    silent?: boolean;
}

/**
 * Drop-in replacement for the plain `<p>Ładowanie...</p>` loaders that
 * used to greet the player on every async route. Renders a SVG ring
 * spinning in the player's transform accent (or a pale-gold fallback)
 * with an optional caption underneath.
 *
 * Usage:
 *   <Spinner />                         // 36-px + "Ładowanie..."
 *   <Spinner size="lg" label="Buduję arenę…" />
 *   <Spinner size="sm" silent />        // 18-px, no caption
 */
const Spinner = ({ label = 'Ładowanie...', size = 'md', silent = false }: IProps) => (
    <div className={`spinner spinner--${size}`} role="status" aria-live="polite">
        <span className="spinner__ring" aria-hidden="true">
            <svg viewBox="0 0 50 50" focusable="false">
                <circle
                    className="spinner__track"
                    cx="25" cy="25" r="20"
                    fill="none"
                    strokeWidth="5"
                />
                <circle
                    className="spinner__head"
                    cx="25" cy="25" r="20"
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                />
            </svg>
        </span>
        {!silent && <span className="spinner__label">{label}</span>}
    </div>
);

export default Spinner;
