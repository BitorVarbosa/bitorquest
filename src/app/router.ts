// A tiny hash router: the app is static files with no server, so screens live after the "#".
//   #/            your stories          #/play        the story
//   #/welcome     key setup             #/people      everyone you know     #/person/mira   one profile
//   #/settings    settings              #/character   the sheet             #/journal       the journal
//   #/usage       spending              #/map         the map               #/journal/codex what has been discovered
//   #/recap       "Previously…": where the open story stands
//   #/worlds      the worlds library (?pick: choosing where a new story takes place)
//   #/world-new   a new world, step by step      #/world-new/<draft>?step=table   one being built
//   #/character-new/<world>   a character for a new story in that world
import { useSyncExternalStore } from 'react';

export interface Route {
  name: string;
  arg: string | null;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', search = ''] = raw.split('?');
  const [name = '', arg] = path.split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : null, query: new URLSearchParams(search) };
}

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};
const snapshot = () => window.location.hash;

export function useRoute(): Route {
  return parseHash(useSyncExternalStore(subscribe, snapshot));
}

/** A link target: href("person/mira") -> "#/person/mira". */
export function href(path: string): string {
  return `#/${path.replace(/^\/+/, '')}`;
}

export function go(path: string, replace = false): void {
  const target = href(path);
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}
