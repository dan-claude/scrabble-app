import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DICT_PATH = path.join(__dirname, '..', 'words', 'dictionary.txt');

const words = fs.readFileSync(DICT_PATH, 'utf8').split('\n').filter(Boolean);
export const DICTIONARY = new Set(words);

export function isValidWord(word) {
  return DICTIONARY.has(word.toUpperCase());
}

console.log(`[dictionary] loaded ${DICTIONARY.size} words`);
