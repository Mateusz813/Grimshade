import type { FC, SVGProps } from 'react';
import './Twemoji.scss';

/**
 * Render a game icon by its SEMANTIC NAME as an INLINE <svg> (no <img>, no
 * emoji characters, no parser).
 *
 *   <GameIcon name="crossed-swords" />  ->  <svg class="game-icon">…</svg>
 *
 * Every SVG in src/assets/icons is imported as a React component via
 * vite-plugin-svgr's `?react` query (sized 1em via `svgrOptions.icon`), so
 * icons scale with font-size and monochrome ones tint with `currentColor`.
 * Unknown name -> renders nothing (a typo can't crash the UI).
 */

const ICON_COMPONENTS = import.meta.glob<FC<SVGProps<SVGSVGElement>>>(
  '../../../assets/icons/*.svg',
  { query: '?react', eager: true, import: 'default' },
);

const NAME_TO_COMPONENT: Record<string, FC<SVGProps<SVGSVGElement>>> = {};
for (const [filePath, Comp] of Object.entries(ICON_COMPONENTS)) {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.svg$/, '');
  NAME_TO_COMPONENT[name] = Comp;
}

/** All available icon names (for tooling / validation). */
export const ALL_ICON_NAMES = Object.keys(NAME_TO_COMPONENT);

interface IGameIconProps {
  /** Semantic icon name = the slug filename in src/assets/icons, e.g. "crossed-swords". */
  name: string;
  /** Extra class merged onto the <svg>. */
  className?: string;
  /** Accessible label; defaults to decorative (aria-hidden). */
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
