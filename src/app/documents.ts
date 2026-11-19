// Opening a document the player wants a world built from: the text is taken out of the file here, on
// the device, and made ready to be read (game/ingest.ts). Nothing is sent anywhere by this.
import { newDoc, tidyPages, tidyText, type DocState } from '../game/ingest';
import { t } from '../i18n';

/** What the file chooser offers. */
export const DOC_ACCEPT = '.txt,.md,.markdown,.text,.pdf,text/plain,text/markdown,application/pdf';
/** A file larger than this is not opened: it would not be a text. */
export const DOC_MAX_BYTES = 80 * 1024 * 1024;

export type Opened =
  | { doc: DocState; /** Lines left out because they repeat on every page (running heads, page numbers, a watermark). */ repeated: number }
  | { problem: string };

const isPdf = (file: File): boolean => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const isText = (file: File): boolean => file.type.startsWith('text/') || /\.(txt|text|md|markdown)$/i.test(file.name);

/** Take the text out of a file. `onProgress` is called as the pages of a PDF are gone through. */
export async function openDocument(file: File, onProgress?: (done: number, of: number) => void): Promise<Opened> {
  if (file.size > DOC_MAX_BYTES) return { problem: t('That file is too large to be a document the app can read.') };
  try {
    if (isPdf(file)) {
      const { pdfPages, PdfProblem } = await import('./pdf');
      let pages: string[];
      try {
        pages = await pdfPages(await file.arrayBuffer(), onProgress);
      } catch (err) {
        return { problem: err instanceof PdfProblem ? err.message : t('That file could not be read as a PDF.') };
      }
      const { text, repeated } = tidyPages(pages);
      // Pages with next to nothing on them are pictures of text: a scan.
      const words = (text.match(/\S+/g) ?? []).length;
      if (words < pages.length * 12) return { problem: t('No text was found in that PDF: its pages seem to be pictures of text (a scan). The app cannot read those.') };
      return { doc: newDoc(file.name, pages.length, text), repeated };
    }
    if (isText(file) || file.type === '') {
      const raw = await file.text();
      // A file that is not text at all shows as a scatter of characters that mean nothing.
      const odd = (raw.slice(0, 20_000).match(/[\u0000-\u0008�]/g) ?? []).length;
      if (odd > 20) return { problem: t('That file does not look like text. Text, Markdown and PDF files can be read.') };
      return { doc: newDoc(file.name, null, tidyText(raw)), repeated: 0 };
    }
    return { problem: t('Text, Markdown and PDF files can be read. For another kind of file, save or export it as one of those first.') };
  } catch (err) {
    return { problem: err instanceof Error && /too little text/.test(err.message) ? err.message : t('That file could not be read.') };
  }
}
