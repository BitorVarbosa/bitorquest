// A story as a book: one HTML file that opens in any browser and prints well, with the story told
// from its first scene to its last and nothing of the machinery. No request is made: everything in it
// is already kept on the device. The labels are in the story's language.
import { tl, type Lang } from '../i18n';
import { parseReply } from './llm/parse';
import { sceneTitle } from './story';
import type { Beat, Scene, SceneArchive, Story } from './types';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The story told in a scene's turns, as paragraphs of the book. The player's own actions are kept, set apart; dice are a quiet line. */
function sceneHtml(turns: Scene['turns'], l: Lang, dice: boolean): string {
  const out: string[] = [];
  for (const turn of turns) {
    for (const b of turn.beats as Beat[]) {
      if (b.type === 'action') out.push(`<p class="act">${esc(b.text)}${b.clarified ? ` <span>(${esc(b.clarified)})</span>` : ''}</p>`);
      else if (b.type === 'narration') out.push(`<p>${esc(b.text)}</p>`);
      else if (b.type === 'say') out.push(`<p class="say"><b>${esc(b.name)}</b>${b.manner ? ` <i>(${esc(b.manner)})</i>` : ''} “${esc(b.text)}”</p>`);
      else if (b.type === 'check' && dice) {
        const r = b.result;
        const word = r.outcome === 'success' ? tl(l, 'Success') : r.outcome === 'cost' ? tl(l, 'Success at a cost') : r.outcome === 'forward' ? tl(l, 'Failed, with a way forward') : tl(l, 'Failed');
        out.push(`<p class="roll">${esc(r.label || tl(l, 'A test'))}${r.die !== null ? ` · ${r.die}` : ''} · ${esc(word)}</p>`);
      }
    }
    // A turn kept before its beats held the telling: the reply itself, read as story.
    if (!turn.beats.some((b) => b.type === 'narration' || b.type === 'say') && turn.reply) {
      for (const part of parseReply(turn.reply).parts) out.push(part.type === 'say' ? `<p class="say"><b>${esc(part.tag)}</b> “${esc(part.text)}”</p>` : `<p>${esc(part.text)}</p>`);
    }
  }
  return out.join('\n');
}

/**
 * The book: a cover, then each chapter with its scenes in order, then the epilogue when there is one.
 * `kept` are the transcripts of finished scenes kept beside the story; scenes still in memory are read
 * from the story. A scene with nothing told in it is left out.
 */
export function storyBook(story: Story, kept: SceneArchive[], opts: { dice?: boolean; now?: number } = {}): string {
  const l: Lang = story.settings.language === 'pt' ? 'pt' : 'en';
  const byId = new Map(kept.map((a) => [a.sceneId, a]));
  const titleOf = (n: number) => story.chapters.find((c) => c.n === n)?.title ?? (story.chapter.n === n ? story.chapter.title : '');
  const parts: string[] = [];
  let chapter = -1;
  for (const scene of story.scenes) {
    const turns = scene.turns.length ? scene.turns : byId.get(scene.id)?.turns ?? [];
    if (!turns.length) continue;
    if (scene.chapter !== chapter) {
      if (chapter !== -1) parts.push('</section>');
      chapter = scene.chapter;
      const title = titleOf(chapter);
      parts.push(`<section class="chapter"><h2><span>${esc(tl(l, 'Chapter {n}', { n: chapter }))}</span>${title ? esc(title) : ''}</h2>`);
    }
    parts.push(`<h3>${esc(sceneTitle(story, scene))}</h3>`, sceneHtml(turns, l, opts.dice ?? true));
  }
  if (chapter !== -1) parts.push('</section>');
  if (story.epilogue) {
    parts.push(`<section class="chapter epilogue"><h2><span>${esc(tl(l, 'Epilogue'))}</span></h2>${story.epilogue.text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join('\n')}${story.epilogue.legend ? `<p class="legend">${esc(story.epilogue.legend)}</p>` : ''}</section>`);
  }
  const p = story.protagonist;
  const date = new Date(opts.now ?? Date.now()).toLocaleDateString(l === 'pt' ? 'pt-BR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `<!doctype html>
<html lang="${l === 'pt' ? 'pt-BR' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(story.title)}</title>
<style>
:root{color-scheme:light dark;--ink:#22201c;--soft:#6b655b;--line:#d8d0c2;--page:#fbf8f2;--accent:${/^#[0-9a-f]{6}$/i.test(story.world.accent) ? story.world.accent : '#2b7a70'}}
@media (prefers-color-scheme:dark){:root{--ink:#e9e4da;--soft:#a39b8d;--line:#3a362f;--page:#16140f}}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:18px/1.65 Georgia,'Iowan Old Style','Palatino Linotype',serif}
main{max-width:38rem;margin:0 auto;padding:3rem 1.25rem 4rem}
.cover{text-align:center;padding:4rem 0 3rem;border-bottom:1px solid var(--line);margin-bottom:2rem}
.cover h1{font-size:2.4rem;line-height:1.15;margin:0 0 .75rem;font-weight:normal}
.cover .by{color:var(--soft);margin:0}.cover .pitch{font-style:italic;color:var(--soft);margin:1.5rem auto 0;max-width:30rem}
.chapter{margin:3rem 0}
h2{font-weight:normal;font-size:1.6rem;margin:0 0 1.5rem;text-align:center}
h2 span{display:block;font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:.35rem}
h3{font:600 .8rem/1.4 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--soft);margin:2.25rem 0 1rem;text-align:center}
p{margin:0 0 1rem}
.act{font-style:italic;color:var(--soft);border-left:2px solid var(--accent);padding-left:.8rem}
.act span{font-style:normal}
.say b{font:600 .85em system-ui,sans-serif;color:var(--accent);margin-right:.25rem}
.roll{font:.75rem/1.4 system-ui,sans-serif;color:var(--soft);text-align:right}
.legend{text-align:center;font-style:italic;margin-top:2rem}
footer{border-top:1px solid var(--line);margin-top:3rem;padding-top:1rem;font:.8rem system-ui,sans-serif;color:var(--soft);text-align:center}
@media print{body{background:#fff;color:#000;font-size:12pt}main{max-width:none;padding:0}.chapter{break-before:page}.cover{border:0;padding-top:30vh}.roll{display:none}}
</style>
</head>
<body>
<main>
<header class="cover"><h1>${esc(story.title)}</h1><p class="by">${esc(p.name)} · ${esc(story.world.name)}</p>${story.world.pitch ? `<p class="pitch">${esc(story.world.pitch)}</p>` : ''}</header>
${parts.join('\n')}
<footer>${esc(tl(l, 'Played with Bitor Quest'))} · ${esc(date)}</footer>
</main>
</body>
</html>
`;
}
