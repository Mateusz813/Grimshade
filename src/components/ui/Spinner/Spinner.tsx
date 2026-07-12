import './Spinner.scss';

interface IProps {
    label?: string;
    size?: 'sm' | 'md' | 'lg';
    silent?: boolean;
}

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
