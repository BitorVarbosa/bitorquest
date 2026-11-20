// The Portuguese words, one file for each part of the app. Importing this file adds them all.
// A text that stands in two files must say the same thing in both: tests/i18n.test.ts checks it.
import { addWords } from '../../i18n';
import character from './character';
import engine from './engine';
import features from './features';
import game from './game';
import home from './home';
import journal from './journal';
import people from './people';
import play from './play';
import rules from './rules';
import services from './services';
import settings from './settings';
import shell from './shell';
import welcome from './welcome';
import worlds from './worlds';

export const PARTS: Record<string, Record<string, string>> = { character, engine, features, game, home, journal, people, play, rules, services, settings, shell, welcome, worlds };

for (const words of Object.values(PARTS)) addWords(words);
