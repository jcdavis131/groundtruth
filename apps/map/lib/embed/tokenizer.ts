// BERT uncased WordPiece, written here so the embedder has no runtime
// dependency: the same steps Hugging Face `tokenizers` takes for the
// potion-base-8M tokenizer.json (BertNormalizer with clean_text,
// handle_chinese_chars, lowercase and strip_accents unset, which strips
// accents when lowercasing; BertPreTokenizer; WordPiece with "##",
// max_input_chars_per_word 100, unk "[UNK]").
//
// The vocabulary is the model's own (tokenizer.json model.vocab, re-indexed by
// MinishLab: [CLS] is 2, not bge's 101), and the post-processor is never
// applied: model2vec encodes without [CLS]/[SEP] and drops [UNK]. Token ids are
// checked against the Python tokenizers output in lib/embed/potion.test.ts.

/** Characters BERT's clean_text removes: Unicode "other" (Cc, Cf, Cs, Co, Cn), except tab, newline and carriage return. */
function isControl(c: string): boolean {
  if (c === "\t" || c === "\n" || c === "\r") return false;
  return /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u.test(c);
}

/** Whitespace as BERT's clean_text sees it: tab, newline, carriage return, and Unicode White_Space. */
function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r" || /\s/u.test(c);
}

/** CJK ideographs, the ranges BertNormalizer pads with spaces. */
function isChinese(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b920 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** BertPreTokenizer's punctuation: ASCII punctuation (which includes $ + < = > ^ ` | ~) or a Unicode P* character. */
function isPunctuation(c: string): boolean {
  const cp = c.codePointAt(0)!;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(c);
}

/** BertNormalizer: clean text, pad CJK, strip accents (NFD, drop Mn) and lowercase. */
export function normalize(text: string): string {
  let out = "";
  for (const c of text) {
    const cp = c.codePointAt(0)!;
    if (cp === 0 || cp === 0xfffd || isControl(c)) continue;
    if (isWhitespace(c)) out += " ";
    else if (isChinese(cp)) out += ` ${c} `;
    else out += c;
  }
  out = out.normalize("NFD").replace(/\p{Mn}/gu, "");
  // Per character, as Rust char::to_lowercase does (no final-sigma context rule).
  let lower = "";
  for (const c of out) lower += c.toLowerCase();
  return lower;
}

/** BertPreTokenizer: split on whitespace, and each punctuation character is its own word. */
export function preTokenize(text: string): string[] {
  const words: string[] = [];
  let cur = "";
  for (const c of text) {
    if (isWhitespace(c)) {
      if (cur) words.push(cur);
      cur = "";
    } else if (isPunctuation(c)) {
      if (cur) words.push(cur);
      words.push(c);
      cur = "";
    } else cur += c;
  }
  if (cur) words.push(cur);
  return words;
}

export interface WordPieceVocab {
  /** Token string -> id. */
  ids: ReadonlyMap<string, number>;
  unkId: number;
}

export const MAX_INPUT_CHARS_PER_WORD = 100;

/** Greedy longest-match-first WordPiece over one pre-tokenised word; a word with an unmatched piece is a single [UNK]. */
export function wordPiece(word: string, v: WordPieceVocab): number[] {
  const chars = Array.from(word);
  if (chars.length > MAX_INPUT_CHARS_PER_WORD) return [v.unkId];
  const out: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found: number | undefined;
    while (start < end) {
      const piece = (start > 0 ? "##" : "") + chars.slice(start, end).join("");
      const id = v.ids.get(piece);
      if (id !== undefined) {
        found = id;
        break;
      }
      end--;
    }
    if (found === undefined) return [v.unkId];
    out.push(found);
    start = end;
  }
  return out;
}

/** Token ids for a text, without special tokens (as model2vec asks tokenizers: add_special_tokens=False). [UNK] is kept here; the embedder drops it. */
export function tokenize(text: string, v: WordPieceVocab): number[] {
  const ids: number[] = [];
  for (const w of preTokenize(normalize(text))) ids.push(...wordPiece(w, v));
  return ids;
}

/** A vocabulary from the token list in id order (vocab.txt, one token per line). */
export function vocabFromList(tokens: readonly string[], unk = "[UNK]"): WordPieceVocab {
  const ids = new Map<string, number>();
  tokens.forEach((t, i) => ids.set(t, i));
  const unkId = ids.get(unk);
  if (unkId === undefined) throw new Error(`vocabulary has no ${unk}`);
  return { ids, unkId };
}
