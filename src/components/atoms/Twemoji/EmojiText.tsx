import { Fragment, type ReactNode } from 'react';
import GameIcon, { ALL_ICON_NAMES } from './GameIcon';

const ICON_NAME_SET = new Set(ALL_ICON_NAMES);


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
    if (!ICON_NAME_SET.has(name)) continue;
    if (m.index > last) parts.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    parts.push(<GameIcon key={key++} name={name} />);
    last = m.index + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);

  return <>{parts}</>;
};

export default EmojiText;
