// A picture as a reference for how a companion looks: the player shows it, may add a word, and gets
// words back to keep in the description. The picture itself is never kept: it is made smaller on this
// device, sent once to be put into words, and forgotten. Only the words stay, where the player can read
// and change them.
import { useRef, useState } from 'react';
import { BudgetReached } from '../../game/builder';
import { modelInfo } from '../../game/llm/models';
import { t } from '../../i18n';
import { useApp } from '../app';
import { Icon, Modal } from '../ui';
import { usePrice } from './Tools';

/** The longest side a picture is sent at, in pixels: enough to read a face and a coat, at about 800 tokens. */
const LONG_SIDE = 768;

/** Make a picture small enough to send, on this device. No address of the file is made: the page's rules allow none. */
async function shrink(file: File): Promise<{ data: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#fff'; // a see-through picture is laid on white, as JPEG has no see-through
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const preview = canvas.toDataURL('image/jpeg', 0.85);
  return { data: preview.slice(preview.indexOf(',') + 1), preview };
}

/** What putting a picture into words is expected to cost: about 1,000 tokens read and 100 written, on the cheapest model. */
function pictureCost(model: string): number {
  const m = modelInfo(model);
  return (1050 * m.input + 110 * m.output) / 1_000_000;
}

/**
 * A button that takes a picture of `who`, lets the player add a word on it, and hands the words that
 * come back (a look at a glance and a full description) to `onWords`.
 */
export function PictureButton({ who, language, onWords, ledger }: { who: string; language: 'en' | 'pt'; onWords: (look: string, appearance: string) => void; ledger?: string }) {
  const a = useApp();
  const price = usePrice();
  const input = useRef<HTMLInputElement>(null);
  const [shot, setShot] = useState<{ data: string; preview: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!file.type.startsWith('image/')) { setProblem(t('That is not a picture.')); return; }
    try {
      setShot(await shrink(file));
      setNote('');
    } catch {
      setProblem(t('That picture could not be opened here. Try a JPEG or PNG.'));
    }
  };
  const close = () => { setShot(null); setNote(''); setBusy(false); };
  const read = async () => {
    if (!shot) return;
    setBusy(true);
    setProblem(null);
    try {
      const words = await a.describePicture({ data: shot.data, mediaType: 'image/jpeg' }, who, note, language, ledger);
      onWords(words.look, words.appearance);
      close();
    } catch (err) {
      setBusy(false);
      setProblem(err instanceof BudgetReached ? t('Today’s spending limit is reached, so nothing was sent.') : err instanceof Error && err.message ? err.message : t('The picture could not be put into words.'));
    }
  };
  const name = who.split(',')[0]!.trim();
  return (
    <>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className="btn btn-fit pic-btn" onClick={() => input.current?.click()}><Icon name="upload" size={16} />{t('Describe from a picture')}</button>
      {problem && !shot && <p className="help t-err" role="alert">{problem}</p>}
      {shot && (
        <Modal title={t('How {name} looks', { name })} onClose={close} foot={
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void read()}>
            {busy ? t('Reading the picture…') : <>{t('Put it into words')}<span className="take-p">· {price(pictureCost(a.models().scribe))}</span></>}
          </button>
        }>
          <img className="pic-shot" src={shot.preview} alt={t('The picture you chose')} />
          <div className="f">
            <label className="label" htmlFor="pic-note">{t('Anything to add?')} <span className="t-2">· {t('optional')}</span></label>
            <input className="input" id="pic-note" type="text" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('For example: older than this; without the hat')} />
            <p className="help">{t('Where the picture and your words disagree, your words win.')}</p>
          </div>
          <p className="help">{t('The picture is sent once to be described, then forgotten: it is not kept on this device or anywhere else. Only the words are kept, and you can change them. A real person is never named from a picture.')}</p>
          {problem && <p className="help t-err" role="alert">{problem}</p>}
        </Modal>
      )}
    </>
  );
}
