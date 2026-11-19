// The dice. A die is thrown, not just shown: it crouches, leaps three times, each leap lower than the
// last, turning as it goes and showing another face every few hundredths of a second, slower and
// slower, until it comes to rest on the face the rules rolled (styles/slate.css draws the leaps; the
// faces are changed here). Whoever draws a die can follow the face it shows, to move numbers with it.
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { FLIPS, REST_MS, THROW_MS, faceRun, type ThrowState } from './table';

/** Animations are on unless the player, or their device, asked for less motion (the attribute is set with the theme). */
const motionOn = () => document.documentElement.dataset.motion === 'on';

export interface Thrown {
  /** The face each die shows now. Null: it has not left the hand. */
  shown: (number | null)[];
  /** The dice are in the air. */
  air: boolean;
  /** They came to rest while this was on screen: the moment for whatever answers a result. */
  landed: boolean;
}

/**
 * Throw dice that will land on `faces`. While `state` is 'ready' they wait; when it becomes 'rolling'
 * they leave the hand after `delay` and `onLanded` is called when they have come to rest. With
 * animations off (or `animate` false) they are simply there.
 */
export function useThrow(faces: number[], state: ThrowState, opts: { animate?: boolean; delay?: number; onLanded?: () => void } = {}): Thrown {
  const [inAir, setInAir] = useState<number[] | null>(null);
  const [landed, setLanded] = useState(false);
  const done = useRef(opts.onLanded);
  done.current = opts.onLanded;
  const want = useRef({ faces, animate: opts.animate ?? true, delay: opts.delay ?? 0 });
  want.current = { faces, animate: opts.animate ?? true, delay: opts.delay ?? 0 };
  const key = faces.join();
  useEffect(() => {
    if (state !== 'rolling') return;
    const { faces: final, animate, delay } = want.current;
    const timers: number[] = [];
    const after = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };
    const land = () => { setInAir(null); setLanded(true); done.current?.(); };
    setLanded(false);
    if (!animate || !motionOn()) {
      after(0, land);
    } else {
      const runs = final.map((f) => faceRun(f));
      after(delay, () => {
        setInAir(runs.map((r) => r[0] ?? 1));
        FLIPS.forEach((at, i) => after(at, () => setInAir(runs.map((r) => r[i + 1] ?? 1))));
        after(REST_MS, () => setInAir([...final]));
        after(THROW_MS, land);
      });
    }
    return () => { for (const id of timers) window.clearTimeout(id); };
    // A throw begins when the state says so, and is the same throw for as long as the faces are.
  }, [state, key]);
  const settled = state === 'still' || landed;
  return {
    shown: settled ? faces : state === 'rolling' && inAir ? inAir : faces.map(() => null),
    air: !settled && state === 'rolling' && !!inAir,
    landed,
  };
}

/**
 * A six-sided die as it is drawn: white with black pips for the player, dark for an opponent, and a
 * question mark while it has not been thrown. It is a button when pressing it does something.
 */
export function DieFace({ face, foe = false, small = false, air = false, ask = false, label, onPress }: {
  face: number | null; foe?: boolean; small?: boolean;
  /** It is in the air. */ air?: boolean;
  /** It is waiting for the player to throw it. */ ask?: boolean;
  label: string; onPress?: () => void;
}) {
  const cls = `die${foe ? ' die-foe' : ''}${small ? ' die-s' : ''}${air ? ' tumble' : ''}${ask ? ' die-ask' : ''}${face === null ? ' die-unk' : ''}`;
  const pips = face === null ? '?' : <><i /><i /><i /><i /><i /><i /><i /><i /><i /></>;
  return (
    <span className={`die-seat${air ? ' is-air' : ''}`}>
      {onPress
        ? <button type="button" className={cls} data-face={face ?? undefined} onClick={(e) => { e.stopPropagation(); onPress(); }} aria-label={label}>{pips}</button>
        : <span className={cls} data-face={face ?? undefined} role="img" aria-label={label}>{pips}</span>}
    </span>
  );
}

/** A die that already fell, in a record of rolls: it lies there, and pressing it shows the throw again. */
export function Die({ face, foe = false, small = false, label }: { face: number; foe?: boolean; small?: boolean; label?: string }) {
  const [state, setState] = useState<ThrowState>('still');
  const thrown = useThrow([face], state, { onLanded: () => setState('still') });
  return (
    <DieFace
      face={thrown.shown[0] ?? face} foe={foe} small={small} air={thrown.air} onPress={() => setState('rolling')}
      label={label ?? t('Rolled {face}. Press to watch it roll again', { face })}
    />
  );
}
