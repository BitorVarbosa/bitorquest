// A translated text with bold parts and slots that may hold elements:
//   <T text="Reading it will cost <b>{price}</b>, once, with {model}." vars={{ price, model }} />
//   <T text="Open <link>the journal</link> to see it." vars={{ link: (inner) => <a href={href('journal')}>{inner}</a> }} />
// The text is looked up as a whole, tags and slots included, so a translation can move them about.
import { Fragment, type ReactNode } from 'react';
import { t } from '../i18n';

type Slot = ReactNode | ((inner: ReactNode) => ReactNode);

const PART = /<(\w+)>(.*?)<\/\1>|\{(\w+)\}/g;

export function rich(text: string, vars: Record<string, Slot> = {}): ReactNode {
  const out: ReactNode[] = [];
  let at = 0;
  let key = 0;
  for (const hit of text.matchAll(PART)) {
    if (hit.index > at) out.push(text.slice(at, hit.index));
    const [whole, tag, inner, slot] = hit;
    if (slot !== undefined) {
      const v = vars[slot];
      out.push(typeof v === 'function' ? <Fragment key={key++}>{v(null)}</Fragment> : v === undefined ? whole : <Fragment key={key++}>{v}</Fragment>);
    } else if (tag === 'b') {
      out.push(<b key={key++}>{rich(inner ?? '', vars)}</b>);
    } else if (tag === 'i') {
      out.push(<i key={key++}>{rich(inner ?? '', vars)}</i>);
    } else {
      const v = tag ? vars[tag] : undefined;
      out.push(<Fragment key={key++}>{typeof v === 'function' ? v(rich(inner ?? '', vars)) : rich(inner ?? '', vars)}</Fragment>);
    }
    at = hit.index + whole.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out.length === 1 ? out[0] : out;
}

export function T({ text, vars }: { text: string; vars?: Record<string, Slot> }): ReactNode {
  return rich(t(text), vars);
}
