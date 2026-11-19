// Story files: handing one to the browser to save, and saying how big it is.
import { app } from './app';

/** Save a story as a file through the browser's download. False when the story could not be put together. */
export async function downloadStory(id: string, title: string): Promise<boolean> {
  const text = await app.exportStory(id);
  if (text === null) return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[^\w -]+/g, '').trim() || 'story'}.bitorquest.json`;
  link.click();
  // The download reads the address after this returns: give it a moment before taking it away.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Save a story as a book: one HTML file that opens in any browser and prints well. False when it could not be put together. */
export async function downloadBook(id: string, title: string): Promise<boolean> {
  const html = await app.bookOf(id);
  if (html === null) return false;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/[^\w -]+/g, '').trim() || 'story'}.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** "640 KB", "1.8 MB", "10 GB". */
export function fileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

/** Save a world as a file through the browser's download. False when the world is not in the library. */
export function downloadWorld(id: string, name: string): boolean {
  const text = app.exportWorld(id);
  if (text === null) return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\w -]+/g, '').trim() || 'world'}.bitorquest-world.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
