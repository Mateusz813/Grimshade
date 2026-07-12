import './Icon.scss';
import { ICON_PATHS, type IconName } from './icons';

export interface IIconProps {
  name: IconName;
  size?: number | string;
  className?: string;
  title?: string;
}

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
