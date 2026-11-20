// The three services that can play the game, as the screens describe them, and their lists of models.
// Words are marked with m() and translated where they are drawn.
import { MODELS, SERVICE_NAME, type ModelInfo, type Service } from '../game/llm/models';
import { listNanoModels } from '../game/llm/nanogpt';
import { listVeniceModels } from '../game/llm/venice';
import { m } from '../i18n';

export interface ServiceInfo {
  id: Service;
  /** The service's own name: never translated. */
  name: string;
  /** One line on what it is good for. */
  line: string;
  /** What a key looks like, as a placeholder. Not translated. */
  placeholder: string;
  /** Where its keys are made, as a link and as shown. */
  site: { href: string; label: string };
  /** How to get a key, step by step. A step may hold <b>…</b>. */
  steps: string[];
  /** How checking the key works, in one line. */
  check: string;
}

export const SERVICE_INFO: Record<Service, ServiceInfo> = {
  anthropic: {
    id: 'anthropic',
    name: SERVICE_NAME.anthropic,
    line: m('Anthropic’s models. The richest storytelling, and long stories stay cheap because what was already read is cached.'),
    placeholder: 'sk-ant-…',
    site: { href: 'https://platform.claude.com', label: 'platform.claude.com' },
    steps: [
      m('Open the Claude Console at <b>platform.claude.com</b> and sign in. It is separate from a claude.ai subscription.'),
      m('Add credit, then create an API key just for this app.'),
      m('Set a monthly spend limit on that key, so a mistake can never cost more than you chose.'),
    ],
    check: m('Checking the key asks Anthropic which models it can use. That costs nothing.'),
  },
  venice: {
    id: 'venice',
    name: SERVICE_NAME.venice,
    line: m('Private: its own models keep nothing of what you send. Many of them are uncensored.'),
    placeholder: 'VENICE-…',
    site: { href: 'https://venice.ai/settings/api', label: 'venice.ai/settings/api' },
    steps: [
      m('Open <b>venice.ai/settings/api</b> and sign in, then add credit.'),
      m('Create an API key just for this app. If Venice offers a privacy setting for the key, choose <b>Private models only</b>: the key itself then refuses any model that is not private.'),
      m('Give the key a spending limit, so a mistake can never cost more than you chose.'),
    ],
    check: m('Checking the key asks Venice for your balance. That costs nothing.'),
  },
  nanogpt: {
    id: 'nanogpt',
    name: SERVICE_NAME.nanogpt,
    line: m('Hundreds of models from many companies, uncensored ones among them. Most pass what you send on to the company that runs them.'),
    placeholder: '00000000-0000-…',
    site: { href: 'https://nano-gpt.com/api', label: 'nano-gpt.com/api' },
    steps: [
      m('Open <b>nano-gpt.com</b> and sign in, then add balance.'),
      m('Create an API key just for this app, on the API page of your account.'),
    ],
    check: m('Checking the key asks NanoGPT for your balance. That costs nothing.'),
  },
};

const lists: Partial<Record<Service, Promise<ModelInfo[]>>> = {};

/**
 * A service's models, with their prices and what each can do. Claude's are the game's own table; the
 * others are read from the service's public list once while the app is open (a failure is not kept).
 */
export function modelsOf(service: Service): Promise<ModelInfo[]> {
  if (service === 'anthropic') return Promise.resolve(Object.values(MODELS));
  lists[service] ??= (service === 'venice' ? listVeniceModels() : listNanoModels())
    .then((list) => list.sort((x, y) => x.label.localeCompare(y.label)))
    .catch((err: unknown) => { delete lists[service]; throw err; });
  return lists[service]!;
}
