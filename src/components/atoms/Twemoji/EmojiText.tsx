import { Fragment, type ReactNode } from 'react';
import GameIcon, { ALL_ICON_NAMES } from './GameIcon';

const ICON_NAME_SET = new Set(ALL_ICON_NAMES);

/**
 * Render a string, turning `:icon-name:` shortcodes into <GameIcon> images.
 *
 * Explicit, opt-in replacement for emoji-in-text: log lines, chat messages and
 * dynamic toasts carry shortcodes (e.g. `:crossed-swords: Atak!`) instead of
 * raw emoji characters, so there are NO emoji glyphs anywhere in the source.
 * Only shortcodes that resolve to a real bundled icon are swapped — anything
 * else (a stray colon, a time like 10:30) is left as plain text.
 *
 *   <EmojiText>{`:hammer: Rozłożono ${name}`}</EmojiText>
 */

const SHORTCODE_RE = /:([a-z0-9][a-z0-9-]*):/g;

interface IEmojiTextProps {
  children: string | null | undefined;
}

const EmojiText = ({ children }: IEmojiTextProps) => {
  const text = children ?? '';
  if (!text.includes(':')) return <>{text}</>;

  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  SHORTCODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SHORTCODE_RE.exec(text)) !== null) {
    const name = m[1];
    if (!ICON_NAME_SET.has(name)) continue; // not a real icon -> leave as-is
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    parts.push(<GameIcon key={key++} name={name} />);
    last = m.index + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);

  return <>{parts}</>;
};

export default EmojiText;
