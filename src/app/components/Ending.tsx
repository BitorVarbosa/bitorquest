// Whether a story builds to an ending or goes on for as long as it is played, and how long it runs.
// Chosen when a world is built (as the default for its stories), when a story begins, and in its settings.
import { ENDING_CHAPTERS } from '../../game/chapters';
import type { StorySettings } from '../../game/types';
import { m, t } from '../../i18n';

type Ending = NonNullable<StorySettings['ending']>;
type Length = NonNullable<StorySettings['length']>;

const ENDINGS: Record<Ending, { name: string; text: string }> = {
  ending: { name: m('With an ending'), text: m('The story builds to a final chapter, then an epilogue says what became of everyone. Afterwards it can go on as a new season, or a new hero can begin in the same world.') },
  endless: { name: m('Goes on'), text: m('No final chapter: the story goes on for as long as you play it.') },
};
const LENGTHS: Record<Length, string> = { short: m('Short'), medium: m('Medium'), long: m('Long') };

/** The default for a story that does not say. A story kept before endings existed goes on: see StorySettings. */
export const ENDING_DEFAULT: { ending: Ending; length: Length } = { ending: 'ending', length: 'medium' };

export function EndingChoice({ ending, length, onChange, id = 'end' }: { ending: Ending; length: Length; onChange: (patch: { ending?: Ending; length?: Length }) => void; id?: string }) {
  return (
    <>
      <div className="f">
        <span className="label" id={`${id}-k`}>{t('How it ends')}</span>
        <div className="seg" role="group" aria-labelledby={`${id}-k`}>
          {(['ending', 'endless'] as const).map((k) => <button key={k} type="button" aria-pressed={ending === k} onClick={() => onChange({ ending: k })}>{t(ENDINGS[k].name)}</button>)}
        </div>
        <p className="help">{t(ENDINGS[ending].text)}</p>
      </div>
      {ending === 'ending' && (
        <div className="f">
          <span className="label" id={`${id}-l`}>{t('Length')}</span>
          <div className="seg" role="group" aria-labelledby={`${id}-l`}>
            {(['short', 'medium', 'long'] as const).map((k) => <button key={k} type="button" aria-pressed={length === k} onClick={() => onChange({ length: k })}>{t(LENGTHS[k])}</button>)}
          </div>
          <p className="help">{t('About {n} chapters. A chapter is about a session of play; it can end sooner when the main thread is done.', { n: ENDING_CHAPTERS[length] })}</p>
        </div>
      )}
    </>
  );
}
