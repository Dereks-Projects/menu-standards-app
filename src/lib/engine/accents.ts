/*
 * Location: menu-standards-app/src/lib/engine/accents.ts
 *
 * Correct accents for the words the program teaches. Menus often drop
 * them: "Cotes-de-Provence", "Gruner Veltliner", "Creme Brulee". Staff
 * should learn the right spelling, so every word the program uses (each
 * wine and cocktail slot, each term, each house term) carries its accents.
 *
 * Three layers, each one only ever adding or correcting marks:
 * 1. The reader writes slots and terms with their correct accents
 *    (prompts/read-base.md), keeping a producer's own spelling, such as
 *    Chateau Ste. Michelle, which uses none.
 * 2. This list fixes the words whose spelling never depends on who made
 *    the wine: appellations and grapes set by law, and kitchen and bar
 *    words. A word whose plain spelling is also correct somewhere, such as
 *    Chateau (Chateau Montelena), Reserve (an American reserve), Rose (Rose
 *    Hill), or Pere (Pere Ventura), is left to the reader.
 * 3. The reader's code makes one name read the same everywhere on a menu
 *    (see read.ts).
 *
 * The letters, their capitals, and the punctuation never change: a mark is
 * added only where the plain letters already match, letter for letter.
 * The item's own name and description stay exactly as printed, as the
 * record of what the menu says.
 *
 * Reviewed by an Advanced Sommelier. Add a word only when its accented
 * spelling is correct in every wine, kitchen, and bar context.
 */

/**
 * Spellings applied wherever the plain letters match, a whole word at a
 * time. A phrase holds a word that would be wrong to accent on its own,
 * such as Fumé, which is also an English word, or Réserve.
 */
const SPELLINGS: readonly string[] = [
  // France: appellations, regions, and label words
  "Médoc",
  "Émilion",
  "Léognan",
  "Estèphe",
  "Supérieur",
  "Supérieure",
  "Mâcon",
  "Mâconnais",
  "Pouilly-Fumé",
  "Fuissé",
  "Véran",
  "Romanée",
  "Savigny-lès-Beaune",
  "Chorey-lès-Beaune",
  "Moulin-à-Vent",
  "Juliénas",
  "Chénas",
  "Régnié",
  "Rôtie",
  "Châteauneuf",
  "Rhône",
  "Côte",
  "Côtes",
  "Corbières",
  "Faugères",
  "Jurançon",
  "Savennières",
  "Sèvre",
  "Crémant",
  "Contrôlée",
  "Cuvée",
  "Cuvées",
  "Millésime",
  "Récoltant",
  "Brut Réserve",
  "Grande Réserve",
  "Brut Rosé",
  // Germany, Austria, Spain, Hungary, South America: grapes and places
  "Grüner",
  "Blaufränkisch",
  "Spätburgunder",
  "Spätlese",
  "Müller-Thurgau",
  "Albariño",
  "Rías",
  "Penedès",
  "Cariñena",
  "Mencía",
  "Ximénez",
  "Señorío",
  "Aszú",
  "Carménère",
  "Torrontés",
  "Mourvèdre",
  "Aligoté",
  // The bar
  "Añejo",
  "Cachaça",
  "Curaçao",
  "Bénédictine",
  "Crème",
  // The kitchen
  "Brûlée",
  "Fraîche",
  "Purée",
  "Purées",
  "Sauté",
  "Sautéed",
  "Soufflé",
  "Soufflés",
  "Béarnaise",
  "Béchamel",
  "Rémoulade",
  "Velouté",
  "Meunière",
  "Niçoise",
  "Frisée",
  "Crudités",
  "Gâteau",
  "Jalapeño",
  "Jalapeños",
  "Açaí",
  "Flambé",
  "Consommé",
  "Gruyère",
  "Crêpe",
  "Crêpes",
  "Éclair",
  "Éclairs",
  "Pâtisserie",
  "Mâche",
  "Provençal",
  "Provençale",
  "Entrée",
  "Entrées",
];

/* Matching the plain letters */

const MARKS = /\p{M}/gu;
const LETTER = /\p{L}/u;

/** Lowercase letters with every mark removed: "Côtes" to "cotes". */
function plain(text: string): string {
  return text.normalize("NFD").replace(MARKS, "").toLowerCase();
}

/** A run of letters, by position in the text's characters. */
type Word = { readonly start: number; readonly end: number; readonly plain: string };

function wordsIn(chars: readonly string[]): Word[] {
  const words: Word[] = [];
  let start = -1;
  for (let index = 0; index <= chars.length; index += 1) {
    const isLetter = index < chars.length && LETTER.test(chars[index] ?? "");
    if (isLetter && start === -1) {
      start = index;
    } else if (!isLetter && start !== -1) {
      words.push({ start, end: index, plain: plain(chars.slice(start, index).join("")) });
      start = -1;
    }
  }
  return words;
}

type Spelling = {
  /** Each word of the spelling, as characters. */
  readonly words: readonly (readonly string[])[];
  readonly plains: readonly string[];
};

/** The spellings by their first word's plain letters, longest phrase first. */
const SPELLINGS_BY_FIRST_WORD: ReadonlyMap<string, readonly Spelling[]> = (() => {
  const index = new Map<string, Spelling[]>();
  for (const entry of SPELLINGS) {
    const chars = Array.from(entry.normalize("NFC"));
    const words = wordsIn(chars).map((word) => chars.slice(word.start, word.end));
    const spelling = { words, plains: words.map((word) => plain(word.join(""))) };
    const first = spelling.plains[0];
    if (first === undefined) {
      continue;
    }
    const list = index.get(first) ?? [];
    list.push(spelling);
    list.sort((a, b) => b.plains.length - a.plains.length);
    index.set(first, list);
  }
  return index;
})();

function isUpperCase(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

/** Writes the spelling's marks onto one word, keeping each letter's capital or small form. */
function markWord(chars: string[], word: Word, spelling: readonly string[]): void {
  if (spelling.length !== word.end - word.start) {
    return;
  }
  for (let offset = 0; offset < spelling.length; offset += 1) {
    const original = chars[word.start + offset] ?? "";
    const marked = spelling[offset] ?? original;
    chars[word.start + offset] = isUpperCase(original) ? marked.toUpperCase() : marked.toLowerCase();
  }
}

/**
 * The text with the list's accents: "Cotes-de-Provence" to
 * "Côtes-de-Provence", "CREME BRULEE" to "CRÈME BRÛLÉE". Only marks change.
 */
export function withAccents(text: string): string {
  const chars = Array.from(text.normalize("NFC"));
  const words = wordsIn(chars);
  let index = 0;
  while (index < words.length) {
    const current = words[index];
    let matched = 0;
    for (const spelling of SPELLINGS_BY_FIRST_WORD.get(current?.plain ?? "") ?? []) {
      const span = words.slice(index, index + spelling.plains.length);
      if (span.length === spelling.plains.length && span.every((word, offset) => word.plain === spelling.plains[offset])) {
        span.forEach((word, offset) => markWord(chars, word, spelling.words[offset] ?? []));
        matched = span.length;
        break;
      }
    }
    index += Math.max(1, matched);
  }
  return chars.join("");
}

/** True when the text carries any accent or other mark. */
export function hasMarks(text: string): boolean {
  return text.normalize("NFD") !== text.normalize("NFD").replace(MARKS, "");
}

/** The text's letters only, lowercase and without marks, for telling two spellings of one name apart. */
export function plainLetters(text: string): string {
  return plain(text).replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Copies the marks of a spelling onto text with the same letters, keeping
 * the text's capitals and punctuation: "CHATEAU LEOVILLE" and "Château
 * Léoville" give "CHÂTEAU LÉOVILLE". Text with other letters comes back
 * unchanged.
 */
export function copyMarks(text: string, spelling: string): string {
  if (plainLetters(text) !== plainLetters(spelling)) {
    return text;
  }
  const isLetterOrDigit = (char: string) => LETTER.test(char) || /\p{N}/u.test(char);
  const source = Array.from(spelling.normalize("NFC")).filter(isLetterOrDigit);
  const chars = Array.from(text.normalize("NFC"));
  let next = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index] ?? "";
    if (isLetterOrDigit(char)) {
      const marked = source[next] ?? char;
      next += 1;
      chars[index] = isUpperCase(char) ? marked.toUpperCase() : marked.toLowerCase();
    }
  }
  return chars.join("");
}