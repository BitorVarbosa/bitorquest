// Thin client for the Pixel Lab v2 REST API.
// The token is read from the user's existing Claude config at run time and is
// never printed, logged or written anywhere.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = 'https://api.pixellab.ai/v2';

function token() {
  if (process.env.PIXELLAB_TOKEN) return process.env.PIXELLAB_TOKEN;
  const cfg = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
  const m = cfg.match(/api\.pixellab\.ai\/mcp"[\s\S]{0,300}?"Authorization":\s*"Bearer ([^"]+)"/);
  if (!m) throw new Error('No Pixel Lab token found in ~/.claude.json');
  return m[1];
}

export async function api(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + route, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status === 529) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${route} -> ${res.status}: ${text.slice(0, 600)}`);
    return JSON.parse(text);
  }
}

export const balance = () => api('GET', '/balance');

/** Wrap PNG bytes as the API's Base64Image shape. */
export const b64 = (buf) => ({ type: 'base64', base64: buf.toString('base64'), format: 'png' });

/** PNG bytes from an API image object (with or without a data: prefix). */
export const bytes = (image) => Buffer.from(image.base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');

/** Running tally of what the API reports each call cost. */
export const spend = { calls: 0, usd: 0, other: [] };
export function track(usage) {
  spend.calls++;
  if (usage?.type === 'usd') spend.usd += usage.usd;
  else if (usage) spend.other.push(usage);
}
