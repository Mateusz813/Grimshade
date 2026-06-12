import './Icon.scss';
import { ICON_PATHS, type IconName } from './icons';

export interface IIconProps {
  /** Registered icon name (see icons.tsx). */
  name: IconName;
  /** Size; defaults to 1em so it scales with surrounding text. */
  size?: number | string;
  /** Extra class for spacing / tinting. */
  className?: string;
  /** Accessible label. Omitted -> decorative (aria-hidden). */
  title?: string;
}

/**
 * Owned inline-SVG icon (Lucide line icons + a few filled shapes). Inherits
 * `color` via `currentColor`, so it tints with text and scales with font-size.
 * Used for non-emoji UI glyphs (eye toggle, refresh, arrows, chevrons, dots).
 */
const Icon = ({ name, size = '1em', className, title }: IIconProps) => (
  <svg
    className={`ui-icon ui-icon--${name}${className ? ` ${className}` : ''}`}
    data-icon={name}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? 'img' : undefined}
    aria-label={title}
    aria-hidden={title ? undefined : true}
    focusable="false"
  >
    {title ? <title>{title}</title> : null}
    {ICON_PATHS[name]}
  </svg>
);

export default Icon;
