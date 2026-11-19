// What moves behind the app: soft glows in the theme's colours, and with "Embers" a few sparks rising.
// Rendered once, behind everything (Root.tsx). It is decoration only: it takes no taps and screen readers skip it.
// The look and the movement are in styles/motion.css; with animations off the glows stand still and the sparks are hidden.
import type { CSSProperties } from 'react';
import { useApp } from '../app';

/** Sixteen sparks. Each has its own place, size, speed, head start, sideways drift and strength, fixed so the sky is the same every time. */
const SPARKS: { x: number; size: number; seconds: number; start: number; drift: number; strength: number }[] = [
  { x: 4, size: 4, seconds: 21, start: -3, drift: 26, strength: 0.7 },
  { x: 11, size: 3, seconds: 27, start: -17, drift: -18, strength: 0.55 },
  { x: 17, size: 5, seconds: 18, start: -9, drift: 34, strength: 0.6 },
  { x: 24, size: 3, seconds: 30, start: -24, drift: 12, strength: 0.5 },
  { x: 30, size: 4, seconds: 23, start: -1, drift: -30, strength: 0.7 },
  { x: 37, size: 3, seconds: 26, start: -13, drift: 22, strength: 0.55 },
  { x: 43, size: 6, seconds: 19, start: -6, drift: -14, strength: 0.45 },
  { x: 50, size: 3, seconds: 29, start: -21, drift: 30, strength: 0.6 },
  { x: 56, size: 4, seconds: 22, start: -11, drift: -24, strength: 0.7 },
  { x: 63, size: 3, seconds: 25, start: -19, drift: 16, strength: 0.55 },
  { x: 69, size: 5, seconds: 17, start: -4, drift: -32, strength: 0.55 },
  { x: 75, size: 3, seconds: 28, start: -15, drift: 20, strength: 0.5 },
  { x: 81, size: 4, seconds: 20, start: -8, drift: -12, strength: 0.7 },
  { x: 87, size: 3, seconds: 24, start: -22, drift: 28, strength: 0.55 },
  { x: 92, size: 5, seconds: 22, start: -12, drift: -22, strength: 0.5 },
  { x: 97, size: 3, seconds: 26, start: -2, drift: -16, strength: 0.6 },
];

export function Backdrop() {
  const a = useApp();
  const kind = a.settings.backdrop;
  if (!a.ready || kind === 'still') return null;
  return (
    <div className="fx" aria-hidden="true">
      <i className="fx-g fx-g1" /><i className="fx-g fx-g2" /><i className="fx-g fx-g3" /><i className="fx-g fx-g4" />
      {kind === 'embers' && SPARKS.map((s) => (
        <i key={s.x} className="fx-m" style={{ '--x': `${s.x}%`, '--s': `${s.size}px`, '--d': `${s.seconds}s`, '--w': `${s.start}s`, '--dx': `${s.drift}px`, '--o': s.strength } as CSSProperties} />
      ))}
    </div>
  );
}
