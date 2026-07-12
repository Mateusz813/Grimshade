import type { FC, SVGProps } from 'react';
import './Twemoji.scss';


const ICON_COMPONENTS = import.meta.glob<FC<SVGProps<SVGSVGElement>>>(
  '../../../assets/icons/*.svg',
  { query: '?react', eager: true, import: 'default' },
);

const NAME_TO_COMPONENT: Record<string, FC<SVGProps<SVGSVGElement>>> = {};
for (const [filePath, Comp] of Object.entries(ICON_COMPONENTS)) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.svg$/, '');
  NAME_TO_COMPONENT[name] = Comp;
}

export const ALL_ICON_NAMES = Object.keys(NAME_TO_COMPONENT);

interface IGameIconProps {
  name: string;
  className?: string;
  title?: string;
}

const GameIcon = ({ name, className, title }: IGameIconProps) => {
  const Comp = NAME_TO_COMPONENT[name];
  if (!Comp) return null;
  return (
    <Comp
      className={`game-icon${className ? ` ${className}` : ''}`}
      data-icon={name}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable={false}
    />
  );
};

export default GameIcon;
