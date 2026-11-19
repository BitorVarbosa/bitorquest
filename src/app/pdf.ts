// Taking the text out of a PDF, on the device. Nothing is sent anywhere by this.
//
// The reading is done by pdf.js (Mozilla, Apache-2.0). It is over a megabyte, so it is loaded only
// when a PDF is actually chosen, and only its text extraction is used: no page is drawn, no font is
// loaded, and nothing is fetched (the app's content policy would not allow it anyway).
import { t } from '../i18n';

/** The text of each page, in order. Throws PdfProblem with a reason the player can read. */
export async function pdfPages(data: ArrayBuffer, onPage?: (done: number, of: number) => void): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({
    data, useWorkerFetch: false, useWasm: false, disableFontFace: true, useSystemFonts: false,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false, enableXfa: false, stopAtErrors: false,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    const name = err instanceof Error ? err.name : '';
    throw new PdfProblem(name === 'PasswordException' ? t('That PDF is protected by a password, so its text cannot be taken out.') : t('That file could not be read as a PDF.'));
  }
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      pages.push(text);
      page.cleanup();
      onPage?.(n, doc.numPages);
    }
    return pages;
  } finally {
    await task.destroy().catch(() => {});
  }
}

export class PdfProblem extends Error {}
