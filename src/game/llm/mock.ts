// The demo client. It answers locally: nothing is sent anywhere and nothing is charged.
//
// It does two jobs:
//  1. Lets anyone try the app, and lets contributors and tests run it, without an API key.
//  2. Checks the request layout. It receives the very same request the real client would send and
//     simulates Anthropic's prompt cache on it (prefix matching at the breakpoints, 5-minute and
//     1-hour lifetimes, the 512-token minimum). If a change to the app ever made the beginning of
//     a request differ from one turn to the next, the simulated cache would miss and the playtest
//     that asserts the hit rate would fail.
//
// Its writing is canned and plainly worse than Claude's. Token counts are estimates (4 characters
// per token) and are labelled as such wherever they are shown.
import type Anthropic from '@anthropic-ai/sdk';
import { approxTokens } from '../cards';
import { mockArchitect } from './mockArchitect';
import type { TokenUsage } from './models';
import type { EpilogueOut, RefereeOut, ScribeOut } from './schemas';
import { LlmError, type LlmRequest, type LlmResponse, type MockHints, type SendOptions, type Transport } from './transport';

const MIN_CACHEABLE_TOKENS = 512;
const LOOKBACK_BLOCKS = 20;
const TTL = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const;

interface Segment {
  text: string;
  mark: '5m' | '1h' | null;
}

function blocksOf(content: string | Anthropic.TextBlockParam[] | Anthropic.MessageParam['content'], role: string): Segment[] {
  if (typeof content === 'string') return [{ text: `${role}\u0001${content}`, mark: null }];
  const out: Segment[] = [];
  for (const b of content) {
    if (b.type !== 'text') continue;
    const cc = b.cache_control;
    out.push({ text: `${role}\u0001${b.text}`, mark: cc ? (cc.ttl === '1h' ? '1h' : '5m') : null });
  }
  return out;
}

/** The request as an ordered list of blocks, in the order the API renders them: system, then messages. */
export function segmentsOf(params: LlmRequest['params']): Segment[] {
  const out: Segment[] = [];
  if (params.system) out.push(...blocksOf(params.system, 'system'));
  for (const m of params.messages) out.push(...blocksOf(m.content, m.role));
  return out;
}

function fnv(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export interface CacheSim {
  account(params: LlmRequest['params'], outputTokens: number): TokenUsage;
}

/** A model of the prompt cache: entries are created at breakpoints and found again by exact prefix. */
export function makeCacheSim(now: () => number): CacheSim {
  const entries = new Map<string, number>(); // prefix key -> time it expires
  return {
    account(params, outputTokens) {
      const segs = segmentsOf(params);
      const keys: string[] = [];
      const cum: number[] = [];
      let h = fnv(2166136261, params.model);
      let chars = 0;
      for (const s of segs) {
        h = fnv(h, s.text + '\u0002');
        chars += s.text.length;
        keys.push(`${h}:${chars}`);
        cum.push(Math.ceil(chars / 4));
      }
      const total = cum[cum.length - 1] ?? 0;
      const t = now();
      const marks = segs.map((s, i) => (s.mark ? i : -1)).filter((i) => i >= 0);

      // Longest prefix already in the cache: from each breakpoint, look back up to 20 blocks.
      let readAt = -1;
      for (const bp of marks) {
        for (let j = bp; j >= Math.max(0, bp - LOOKBACK_BLOCKS); j--) {
          const exp = entries.get(keys[j]!);
          if (exp !== undefined && exp > t) { if (j > readAt) readAt = j; break; }
        }
      }
      const read = readAt >= 0 ? cum[readAt]! : 0;

      // New entries are written at every breakpoint past what was read.
      let write5m = 0;
      let write1h = 0;
      let covered = read;
      for (const bp of marks) {
        const upTo = cum[bp]!;
        const ttl = segs[bp]!.mark!;
        if (upTo < MIN_CACHEABLE_TOKENS) continue;
        if (upTo > covered) {
          if (ttl === '1h') write1h += upTo - covered; else write5m += upTo - covered;
          covered = upTo;
        }
        entries.set(keys[bp]!, t + TTL[ttl]); // written, or refreshed by this read
      }
      if (readAt >= 0) {
        const key = keys[readAt]!;
        const ttl = segs[readAt]!.mark ?? '5m';
        entries.set(key, Math.max(entries.get(key) ?? 0, t + TTL[ttl]));
      }
      return { input: Math.max(0, total - covered), cacheRead: read, cacheWrite5m: write5m, cacheWrite1h: write1h, output: outputTokens };
    },
  };
}

// ---------- Canned answers ----------

const has = (text: string, re: RegExp) => re.test(text);

function mockReferee(h: MockHints): RefereeOut {
  const text = h.input.toLowerCase();
  const out: RefereeOut = { kind: 'act', check: null, targets: [], mentions: [], recall: [], move_to: null, held: null, ability: null, improvise: null, minutes: 5, why_impossible: null, ask: null, ask_options: [], trade: null, contest: null, toward_contest: false };
  // Words to the narrator, not to anyone in the story.
  if (!h.clarified && has(text, /(what (do|did) you mean|what does (that|this|it) mean|how do i (use|open|read|play)|how does the [a-z ]+ work|narrator|game master|what are the rules)/)) return { ...out, kind: 'question', minutes: 0 };
  // "Take her aside" could be a private word or leaving together: ask, once.
  if (!h.clarified && has(text, /(pull|take|draw) [a-z]+ aside/)) {
    return { ...out, kind: 'unclear', minutes: 0, ask: 'Do you want a private word, out of earshot of the others, or to speak where you stand?', ask_options: ['A private word', 'Speak here'] };
  }
  out.targets = h.cast.filter((c) => text.includes(c.name.toLowerCase()) || text.includes(c.id)).map((c) => c.id);
  const exit = h.exits.find((e) => text.includes(e.name.toLowerCase()));
  const ability = h.abilities.find((a) => text.includes(a.name.toLowerCase()));
  // Asking to be taught something a person here can teach.
  const lesson = h.teachable.find((a) => text.includes(a.name.toLowerCase()));
  if (lesson && has(text, /\b(teach|show me|learn)\b/)) return { ...out, kind: 'learn', ability: lesson.id, targets: [lesson.by], minutes: 60 };
  // Asking someone along, or a companion to stay behind.
  if (out.targets.length && has(text, /\b(come with me|come along|join me|travel with me|ride with me|walk with me from now)\b/)) return { ...out, kind: 'invite', minutes: 5 };
  if (out.targets.length && has(text, /\b(stay here|stay behind|wait here|part ways|go your own way|go home)\b/)) return { ...out, kind: 'part', minutes: 5 };
  // Trying something that is within reach but not learned.
  const attempt = h.attemptable.find((a) => text.includes(a.name.toLowerCase()));
  if (!ability && attempt) return { ...out, kind: 'ability', ability: attempt.id, minutes: 1 };
  // An effect of the player's own: "I shape the air into ...", "I bend light around ...".
  // What an invented effect would do in a fight, read off a few plain words.
  const effect: NonNullable<RefereeOut['improvise']>['effect'] = has(text, /\b(shield|block|protect|guard|brace)\b/) ? 'guard'
    : has(text, /\b(heal|mend|close the wound)\b/) ? 'heal'
      : has(text, /\b(blind|dazzle|confuse)\b/) ? 'dazzle'
        : has(text, /\b(trip|bind|stun|pin|knock (him|her|them) down)\b/) ? 'stagger'
          : has(text, /\b(strike|blast|burn|hurl|smash|slam|punch|hit|lash)\b/) ? 'damage' : 'none';
  const own = /\b(?:shape|bend|weave|call on|twist)\s+(?:the\s+)?(fire|water|air|earth|light|dark)\b/.exec(text);
  if (!ability && own) return { ...out, kind: 'ability', improvise: { path: own[1] as 'fire', tier: has(text, /\b(everyone|whole|street|crowd)\b/) ? 3 : 1, effect }, minutes: 1 };
  // A world of gifts: eating an item of power the character carries.
  const meal = (h.eatable ?? []).find((i) => text.includes(i.name.toLowerCase()));
  if (meal && has(text, /\b(eat|bite|swallow)\b/)) return { ...out, kind: 'ability', ability: meal.id, minutes: 2 };
  // A world of gifts: a use of one of the character's powers that is not one of their moves. "My power"
  // is the first; a power named by its name ("with my Armament Haki") is that one.
  const namedPower = h.gift ? h.gift.powers.find((p) => p.name && text.includes(p.name.toLowerCase())) : undefined;
  if (!ability && h.gift !== undefined && (namedPower || has(text, /\b(my power|my gift|my quirk|with my power)\b/))) {
    if (h.gift === null || h.gift.powers.length === 0) return { ...out, kind: 'impossible', why_impossible: 'You have no power of your own.', minutes: 0 };
    // Copying someone's power, or taking it, is read off plain words too.
    const taking = has(text, /\b(copy|copies|mimic|mirror)\b/) ? 'copy' : has(text, /\b(steal|take (his|her|their) power|rip (his|her|their) power)\b/) ? 'steal' : null;
    const power = namedPower ?? (taking ? h.gift.powers.find((p) => p.kinds.includes(taking)) : undefined) ?? h.gift.powers[0]!;
    const tier = has(text, /\b(everyone|whole|street|crowd)\b/) ? 3 : has(text, /\b(across|room|far|all of them|everything)\b/) ? 2 : 1;
    const chosen = taking && power.kinds.includes(taking) ? taking : effect !== 'none' && power.kinds.includes(effect) ? effect : 'none';
    return { ...out, kind: 'ability', ability: power.id, improvise: { path: null, tier, effect: chosen as NonNullable<RefereeOut['improvise']>['effect'] }, minutes: 1 };
  }

  // Money and things: buying, selling, giving, changing money. The price is a word; the engine sets the amount.
  const trade = mockTrade(h, text);
  if (trade) return { ...out, kind: 'trade', trade, minutes: 10, check: trade.haggle ? { attribute: 'skill', skill: 'Manipulation', difficulty: 'medium', label: `haggle over ${trade.what}`, opposed_by: out.targets[0] ?? null } : null };
  // An effort in something under way, or the start of something that takes several.
  const effort: RefereeOut['check'] = { attribute: 'skill', skill: 'Athletics', difficulty: 'medium', label: 'keep at it', opposed_by: null };
  if (h.contest && has(text, /\b(run|chase|keep|push on|search|look|try|press|argue|climb|follow|again|faster|corre|procur|insist)/)) return { ...out, kind: 'act', check: effort, toward_contest: true, minutes: 10 };
  const begins = /\b(chase|run after|give chase|go after|search the whole|ransack|debate|argue the case|climb the)\b/.exec(text);
  if (!h.contest && begins) return { ...out, kind: 'act', check: { ...effort, label: begins[1]! }, contest: { label: begins[1]!, length: has(text, /\b(search the whole|ransack|debate|argue the case)\b/) ? 'long' : 'short' }, minutes: 10 };

  if (has(text, /\b(remember|recall|what did|who was|remind me)\b/)) out.recall = text.split(/[^a-z]+/).filter((w) => w.length > 3);
  if (exit && has(text, /\b(go|head|walk|cross|enter|leave|travel|make for|run|return|back to|to the)\b/)) {
    // Nobody walks away from people who mean them harm: leaving has to be won.
    const guard = h.cast.find((c) => c.hostile);
    if (guard) {
      return {
        ...out, kind: 'move', move_to: exit.id, minutes: 10,
        held: `${guard.name} ${guard.count > 1 ? 'are' : 'is'} not going to let you walk away`,
        check: { attribute: 'skill', skill: 'Athletics', difficulty: 'medium', label: 'break away', opposed_by: guard.count === 1 ? guard.id : null },
      };
    }
    return { ...out, kind: 'move', move_to: exit.id, minutes: 10 };
  }
  if (ability) return { ...out, kind: 'ability', ability: ability.id, minutes: 1 };
  if (has(text, /\b(attack|strike|stab|punch|shoot|draw my blade|fight|kill|hit him|hit her|hit them)\b/)) {
    const foes = out.targets.length ? out.targets : h.cast.filter((c) => c.hostile).map((c) => c.id);
    return { ...out, kind: 'fight', targets: foes, minutes: 1 };
  }
  if (has(text, /\b(rest|sleep|make camp|camp|wait|stay)\b/)) {
    // A wait of days: "for three days", "a week", or "until" someone comes (taken as three days).
    const days = /\b(\d+|two|three|four|five|six|seven|ten|fourteen)\s+days?\b/.exec(text)?.[1];
    const n = days ? (Number(days) || { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14 }[days] || 1) : has(text, /\ba week\b/) ? 7 : has(text, /\buntil\b/) ? 3 : 0;
    if (n) return { ...out, kind: 'rest', minutes: n * 1440 };
    return { ...out, kind: 'rest', minutes: has(text, /sleep|camp|night/) ? 480 : 60 };
  }

  const checks: [RegExp, RefereeOut['check'] & object][] = [
    [/\b(lie|bluff|persuade|convince|talk my way|haggle|intimidate|charm|distract|deceive)\b/, { attribute: 'skill', skill: 'Manipulation', difficulty: 'medium', label: 'talk them round', opposed_by: null }],
    [/\b(sneak|slip past|hide|pick the lock|steal|pickpocket|unnoticed)\b/, { attribute: 'skill', skill: 'Crime', difficulty: 'medium', label: 'go unnoticed', opposed_by: null }],
    [/\b(climb|jump|leap|swim|sprint|vault)\b/, { attribute: 'skill', skill: 'Athletics', difficulty: 'medium', label: 'a feat of agility', opposed_by: null }],
    [/\b(force|break|lift|shove|smash|pry)\b/, { attribute: 'strength', skill: null, difficulty: 'medium', label: 'a feat of strength', opposed_by: null }],
    [/\b(search|examine|inspect|study|look for|listen in|eavesdrop)\b/, { attribute: 'skill', skill: 'Investigation', difficulty: 'easy', label: 'look closely', opposed_by: null }],
    [/\b(track|follow|forage|find water|read the weather)\b/, { attribute: 'skill', skill: 'Survival', difficulty: 'medium', label: 'read the land', opposed_by: null }],
  ];
  for (const [re, check] of checks) {
    if (has(text, re)) return { ...out, kind: 'act', check: { ...check, opposed_by: out.targets[0] ?? null }, minutes: 10 };
  }
  if (out.targets.length || has(text, /["“]|\b(ask|tell|say|talk|greet|thank|answer)\b/)) return { ...out, kind: 'talk', minutes: 5 };
  return out;
}

/** A trade, read off plain words. */
function mockTrade(h: MockHints, text: string): RefereeOut['trade'] {
  if (!h.money?.length && !/\bgive\b/.test(text)) return null;
  const haggle = /\b(haggle|bargain|barter|pechinch|barganh)/.test(text);
  const carried = (h.carrying ?? []).find((i) => text.includes(i.name.toLowerCase()));
  const money = (h.money ?? []).find((c) => text.includes(c.name.toLowerCase()) || text.includes(c.id))?.id ?? null;
  const amount = /\b(\d{1,6})\b/.exec(text);
  const base = { what: '', price: null, amount: amount ? Number(amount[1]) : null, money, into: null, item: null, keeps: false, haggle };
  if (/\b(change|exchange|swap)\b.*\b(into|for)\b/.test(text) && (h.money?.length ?? 0) > 1) {
    const into = (h.money ?? []).filter((c) => c.id !== money).find((c) => text.includes(c.name.toLowerCase()) || text.includes(c.id)) ?? (h.money ?? []).find((c) => c.id !== money);
    return { ...base, deal: 'exchange', what: 'money', into: into?.id ?? null };
  }
  if (/\b(sell|vend)/.test(text) && carried) return { ...base, deal: 'sell', what: carried.name, item: carried.id, price: 'cheap' };
  if (/\bgive\b/.test(text) && carried) return { ...base, deal: 'give', what: carried.name, item: carried.id };
  if (/\b(give|pay)\b/.test(text) && /\b(coin|coins|money|silver|marks?|\d+)\b/.test(text)) return { ...base, deal: 'give', what: 'money', price: 'cheap' };
  const bought = /\b(?:buy|purchase|order|rent)\s+(?:a |an |the |some |me )?([a-z ]{2,40})/.exec(text);
  if (bought) {
    const what = bought[1]!.replace(/\b(for|from|with|to|at|and)\b.*$/, '').trim();
    const service = /\b(meal|room|bed|drink|ale|beer|wine|food|fare|ride|bath|stew|supper|breakfast)\b/.test(what);
    const price = /\b(horse|passage|boat)\b/.test(what) ? 'dear' : /\b(sword|blade|bow|armour|armor|coat|cloak|map)\b/.test(what) ? 'costly' : /\b(room|bed|rope|lantern|tool|knife)\b/.test(what) ? 'fair' : /\b(drink|ale|beer|tip)\b/.test(what) ? 'trivial' : 'cheap';
    return { ...base, deal: 'buy', what, price, keeps: !service };
  }
  return null;
}

const pickFrom = <T,>(list: T[], n: number): T | undefined => (list.length ? list[Math.abs(n) % list.length] : undefined);

const OUTCOME_LINES: Record<NonNullable<MockHints['outcome']>, string[]> = {
  success: ['It goes the way you meant it to. Nobody looks twice.', 'It works, and more cleanly than you had any right to expect.', 'For once the world does exactly what you asked of it.'],
  cost: ['It works, though not for free: something small is lost in the doing, and you will notice it later.', 'You get what you wanted, and leave a little more of yourself behind than you planned.'],
  forward: ['It does not work. But in the failing you notice something you would otherwise have missed, and there is another way in.', 'That door is shut to you now. The attempt has shown you where the next one is.'],
  fail: ['It does not work, and there is no softening it.', 'You try, and it is not enough.'],
};
const PARTY_LINES = ['“Your call.” A glance over one shoulder, quick and careful. “I am right behind you.”', '“I would not have done it that way. It might still work.”', '“Keep your voice down. We are not alone here.”', '“Well. That is one way to do it.”'];
// A few sentences of scenery, so a demo reply is about as long as a real one (and costs about as much on the meter).
const AMBIENT = [
  'Somewhere close a shutter bangs twice and is still, and the smell of lamp oil and river mud settles back over everything.',
  'A boy runs past with a string of fish, bare feet slapping the stone, and nobody turns to watch him go.',
  'The light is going the colour of weak tea, and the people around you have begun to walk a little faster without seeming to know why.',
  'Two voices argue over a price somewhere behind you, comfortably, the way people argue who have done it every day for years.',
  'Water moves against the canal wall with a patient, slapping sound that you stopped hearing days ago and now hear again.',
  'A cart goes by loaded with salt sacks, its driver half asleep, the mule choosing the road for both of them.',
  'For a moment the wind brings the flats to you, dry and clean, and then the city closes over it again.',
  'High up, someone is lighting lamps one at a time, and each small flame makes the dark around it a little deeper.',
];
const BYSTANDER_LINES = ['“Not my business,” and a shrug.', '“Mind how you go.”', '“You are not from this side of the canal, are you?”'];

function mockNarration(h: MockHints): string {
  // Another take of the same turn is told with other lines.
  const n = h.turn + (h.take ?? 0) * 7;
  const paras: string[] = [];
  const party = h.cast.filter((c) => c.inParty);
  const others = h.cast.filter((c) => !c.inParty);
  const flags: string[] = [];

  if (h.wait) {
    // Time let pass: ended early when a thread says something is coming.
    const coming = h.threads.find((t) => /\b(arriv|coming|comes|before|deadline|by the end)/i.test(t.title));
    const minutes = coming ? Math.min(h.wait, 2 * 1440) : h.wait;
    paras.push(`The days go by at ${h.place}, one much like the next: you sleep, you eat, you watch the road, and the aches of the last few days leave you one by one.`);
    if (coming) paras.push(`Then, sooner than you had reckoned, it comes: ${coming.title}.`);
    else paras.push('Nothing comes that you were not ready for. On the last morning the light is clear and the place feels like somewhere you have lived.');
    flags.push(`time: ${minutes}`);
  } else if (h.fight) {
    // The engine's account of the round, minus the bookkeeping, with a line of colour in front.
    const blows = h.fight.filter((l) => !l.startsWith('Order of action') && !l.startsWith('The fight is over') && !/is down\.$/.test(l) && !l.includes('Describe the fall'));
    paras.push(`${pickFrom(['It is fast and ugly, all elbows and breath.', 'Boots scrape on stone and somebody is shouting.', 'For a few heartbeats nothing exists but the reach of an arm.'], n)} ${blows.slice(0, 3).join(' ')}`);
    if (h.fightOver === 'won') paras.push('And then it is over. The quiet afterwards is louder than the fight was.');
    if (h.fightOver === 'fled') paras.push('You are clear of them, breathing hard, with the sound of it falling away behind you.');
    if (h.fightOver === 'lost') paras.push('The ground comes up to meet you, and the rest happens somewhere far away.');
    const ally = party[0];
    if (ally && h.fightOver === 'won') flags.push(`bond: ${ally.id} | meaningful | - | You fought side by side with ${ally.name}.`);
    flags.push('time: 1');
  } else {
    if (h.begin) {
      // The first scene of a story: who, where, why, and what just happened, each in a short passage.
      paras.push(`You are ${h.you}. This is the demo narrator, so this introduction is a canned one: with your own key, it would say in a few lines who you are and the life you lead here.`);
      paras.push(`Today you are at ${h.place}.${party.length ? ` ${party.map((c) => c.name).join(' and ')} ${party.length === 1 ? 'is' : 'are'} with you, and the story would say why.` : ''}`);
      paras.push('Then something happens that will not wait, and the story starts from there.');
    } else if (h.opening || h.movedTo) paras.push(`${h.place} opens around you, much as you were told it would be, and for a moment nobody pays you any mind.`);
    const confidant = h.moment ? h.cast.find((c) => c.id === h.moment) : undefined;
    if (confidant) {
      // Someone who has been waiting for a quiet moment gets it.
      paras.push(`You and ${confidant.name} find somewhere out of the way. For a while neither of you says much, and then ${confidant.name} starts to talk about something they have not told you before.`);
      paras.push(`@${confidant.id} (quietly): “I do not say this to many people.” A long breath, eyes on the ground. “Do not make me regret it.”`);
      flags.push('time: 40', `moment: ${confidant.id}`, `bond: ${confidant.id} | meaningful | - | You gave ${confidant.name} your time and listened.`);
    } else {
      if (h.held) paras.push(`You make for the way out, and it is not that simple: ${h.held}.`);
      if (h.outcome) paras.push(pickFrom(OUTCOME_LINES[h.outcome], n) ?? '');
      else if (!h.opening && !h.movedTo && !h.held) paras.push('You do it, and the moment moves on. The place keeps its own rhythm around you.');
      const speaker = h.cast.find((c) => h.input.toLowerCase().includes(c.name.toLowerCase())) ?? pickFrom(party, n);
      if (speaker && speaker.count === 1) paras.push(`@${speaker.id}: ${pickFrom(PARTY_LINES, n + 1)}`);
      else if (others[0] && n % 2 === 0) paras.push(`@${others[0].count > 1 ? others[0].name : others[0].id}: ${pickFrom(BYSTANDER_LINES, n)}`);
      flags.push(`time: ${h.outcome ? 10 : 5}`);
      // An item of power here, taken by the character's own hand: reported (the engine says whether it can be had).
      const found = (h.relics ?? []).find((r) => h.input.toLowerCase().includes(r.name.toLowerCase()) && /\b(take|pick up|grab|pocket|accept)\b/i.test(h.input));
      if (found) { paras.push(`You take ${found.name}, and for a moment it is heavier than it should be.`); flags.push(`got: ${found.id}`); }
      const friend = party[0];
      if (friend && h.outcome === 'success' && n % 3 === 0) flags.push(`bond: ${friend.id} | small | - | You did what you said you would, and ${friend.name} noticed.`);
      const thread = h.threads[0];
      if (thread && h.outcome === 'success' && n % 4 === 1) flags.push(`thread: ${thread.id} | next | Keep going while the way is open.`);
    }
  }
  if (!h.fight && !h.begin) paras.splice(1, 0, `${pickFrom(AMBIENT, n)} ${pickFrom(AMBIENT, n * 3 + 1)} ${pickFrom(AMBIENT, n * 5 + 2)}`);
  paras.push(`${pickFrom(AMBIENT, n * 7 + 3)} The next move is yours.`);
  const exits = h.exits.slice(0, 1).map((e) => `Go to ${e.name}`);
  const talk = party[0] ? [`Ask ${party[0].name} what they think`] : [];
  flags.push(`suggest: ${[...exits, ...talk, 'Look around'].slice(0, 3).join(' | ')}`);
  return `${paras.filter(Boolean).join('\n\n')}\n===\n${flags.join('\n')}`;
}

/** The end of a story, as the demo narrator tells it. */
function mockEpilogue(h: MockHints): EpilogueOut {
  const friends = h.cast.filter((c) => c.inParty).map((c) => c.name);
  return {
    epilogue: `This is the demo narrator, so the epilogue is a canned one. With your own key, this page would say what became of ${h.you} and of everyone who mattered.\n\n${friends.length ? `${friends.join(' and ')} stayed close for a long while after, and the road you shared became a story they told.` : 'The road went quiet after you, and the people you met remembered you in their own way.'}\n\nAt ${h.place} they still talk about how it ended.`,
    legend: `${h.you}, who saw it through.`,
  };
}

/** An answer outside the story. Canned: it says what the real narrator would do with the question. */
function mockAside(h: MockHints): string {
  const q = h.input.toLowerCase();
  const head = 'This is the demo narrator, so the answer is a canned one.';
  if (has(q, /(rule|roll|dice|die|test|fight|damage)/)) return `${head} In short: when something is uncertain the game rolls one six-sided die, and you succeed on a roll at or under your target; a 6 always fails. In a fight, your Strength plus Skill plus a die goes against the other side's Armor plus Skill plus a die, and the difference is the damage.`;
  if (has(q, /(map|screen|app|button|menu|setting|journal|people)/)) return `${head} The tabs along the edge are Story, People, Character, Journal and Map. On the Map, pick a place and press "Travel there". Questions like this one are never said in the story.`;
  if (has(q, /(mean|meant|understand|explain)/)) return `${head} With your own key, the narrator would say again, in plain words, what that passage meant, and tell you only what ${h.you} could know. Nothing in the story has moved while you asked.`;
  return `${head} With your own key, the narrator would answer you here as a game master would at the table: plainly, and without moving the story on. Nobody at ${h.place} heard your question.`;
}

function mockScribe(h: MockHints, transcript: string): ScribeOut {
  const typed = transcript.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2).trim());
  const first = typed[0] ?? 'looked around';
  const witnesses = h.cast.filter((c) => c.count === 1).map((c) => c.id);
  const closes = /THIS SCENE ENDS CHAPTER (\d+)/.exec(transcript);
  return {
    summary: `At ${h.place} you spent ${typed.length} turn${typed.length === 1 ? '' : 's'}; it began with “${first.slice(0, 80)}”.`,
    story_so_far: '',
    events: typed.length ? [{ text: `You were at ${h.place}: ${first.slice(0, 90)}`, importance: 'notable', reach: 'local', actors: [], witnesses }] : [],
    attitudes: [],
    people: [],
    fronts: [],
    looks: [],
    chapter: closes ? {
      summary: `In chapter ${closes[1]} you went from place to place around ${h.place}, asked questions and kept the letter safe. (The demo narrator's summary: with your own key this would say what happened.)`,
      gist: `Chapter ${closes[1]}, as the demo narrator tells it: you kept moving and kept the letter safe.`,
      next_title: 'The Road On',
    } : null,
  };
}

export interface MockOptions {
  /** The clock used for cache lifetimes. Tests pass their own to simulate pauses. */
  now?: () => number;
  /** Milliseconds between pieces of streamed text. 0 in tests. */
  streamDelay?: number;
  /** Fail the next request with this error (for showing and testing the error states). */
  failNext?: LlmError | null;
}

export function mockTransport(options: MockOptions = {}): Transport & { options: MockOptions } {
  const now = options.now ?? (() => Date.now());
  const cache = makeCacheSim(now);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    simulated: true,
    options,
    async send(req: LlmRequest, opts: SendOptions = {}): Promise<LlmResponse> {
      if (options.failNext) {
        const err = options.failNext;
        options.failNext = null;
        throw err;
      }
      const delay = options.streamDelay ?? 0;
      if (req.role === 'architect') {
        // A world-building step: the canned world, after a pause long enough to see the step being worked on.
        if (!req.architect) throw new LlmError('bad_request', 'The demo builder needs to be told which step this is.');
        if (delay) await sleep(delay * 40);
        if (opts.signal?.aborted) throw new LlmError('aborted', 'Stopped.');
        const built = mockArchitect(req.architect);
        // A request with no shape to fill (notes from a document) is answered in plain text.
        const answer = typeof built === 'string' ? built : JSON.stringify(built);
        return { text: answer, parsed: typeof built === 'string' ? null : built, usage: cache.account(req.params, approxTokens(answer)), model: req.params.model, stop: 'end_turn', refusal: null, simulated: true };
      }
      const h = req.hints;
      if (!h) throw new LlmError('bad_request', 'The demo narrator needs hints.');
      let text = '';
      let parsed: unknown = null;
      if (req.role === 'referee') {
        parsed = mockReferee(h);
        text = JSON.stringify(parsed);
        if (delay) await sleep(delay * 12);
      } else if (req.role === 'scribe' && h.picture) {
        // A picture put into words: the demo cannot see it, so it says so and keeps to the caption.
        text = `${h.picture.note.trim() || 'travel-worn, a wide hat, quick eyes'}\n(The demo cannot see pictures.) With your own key, this would say how ${h.picture.who} looks in the picture: build, face, hair, clothes, what they carry and the impression they give.${h.picture.note.trim() ? ` You added: ${h.picture.note.trim()}.` : ''}`;
      } else if (req.role === 'scribe') {
        const last = req.params.messages[req.params.messages.length - 1];
        const body = last && typeof last.content !== 'string' ? last.content.map((b) => (b.type === 'text' ? b.text : '')).join('') : '';
        parsed = mockScribe(h, body);
        text = JSON.stringify(parsed);
      } else if (h.epilogue) {
        parsed = mockEpilogue(h);
        text = JSON.stringify(parsed);
      } else {
        text = h.aside ? mockAside(h) : mockNarration(h);
        if (opts.onText) {
          for (let i = 0; i < text.length; i += 14) {
            if (opts.signal?.aborted) throw new LlmError('aborted', 'Stopped.');
            opts.onText(text.slice(i, i + 14));
            if (delay) await sleep(delay);
          }
        }
      }
      const usage = cache.account(req.params, approxTokens(text));
      return { text, parsed, usage, model: req.params.model, stop: 'end_turn', refusal: null, simulated: true };
    },
  };
}
