// Game time. Time passes when the engine says so: actions, travel, rest. The narrator reports how long
// something took; the engine keeps the clock.
import { m, tl, tln, type Lang } from '../i18n';
import type { Clock } from './types';

const DAY = 24 * 60;

export function addMinutes(clock: Clock, minutes: number): Clock {
  const total = clock.minute + Math.max(0, Math.round(minutes));
  return { day: clock.day + Math.floor(total / DAY), minute: total % DAY };
}

export type DaySlot = 'Night' | 'Dawn' | 'Morning' | 'Midday' | 'Afternoon' | 'Dusk' | 'Evening';

export function slotOf(clock: Clock): DaySlot {
  const h = clock.minute / 60;
  if (h < 5) return m('Night');
  if (h < 7) return m('Dawn');
  if (h < 11) return m('Morning');
  if (h < 14) return m('Midday');
  if (h < 17.5) return m('Afternoon');
  if (h < 19.5) return m('Dusk');
  if (h < 22) return m('Evening');
  return m('Night');
}

/** "Day 12 · Dusk". In English unless a language is given: what is sent to a model is always English. */
export function clockLabel(clock: Clock, l: Lang = 'en'): string {
  return `${tl(l, 'Day {n}', { n: clock.day })} · ${tl(l, slotOf(clock))}`;
}

export function minutesBetween(a: Clock, b: Clock): number {
  return (b.day - a.day) * DAY + (b.minute - a.minute);
}

/** "10 minutes", "2 hours", "1 day". In English unless a language is given. */
export function durationLabel(minutes: number, l: Lang = 'en'): string {
  if (minutes < 60) return tln(l, minutes, '{n} minute', '{n} minutes');
  if (minutes < DAY) return tln(l, Math.round(minutes / 60), '{n} hour', '{n} hours');
  return tln(l, Math.round(minutes / DAY), '{n} day', '{n} days');
}
