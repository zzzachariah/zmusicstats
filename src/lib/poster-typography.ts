/** Keep closing punctuation with the preceding character, and opening punctuation with the next. */
export function wrapPosterTextLines(value: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    const chinese = /[\u3400-\u9fff]/u.test(paragraph);
    const tokens: string[] = [];
    if (chinese) {
      let prefix = "";
      for (const character of Array.from(paragraph)) {
        if (/[（【《「『“‘]/u.test(character)) { prefix += character; continue; }
        if (/[，。？！；：、…,.!?;:%％）】》」』”’]/u.test(character) && tokens.length && !prefix) tokens[tokens.length - 1] += character;
        else { tokens.push(prefix + character); prefix = ""; }
      }
      if (prefix) tokens.push(prefix);
    } else tokens.push(...paragraph.split(" "));
    let current = "";
    for (const token of tokens) {
      const next = current ? `${current}${chinese ? "" : " "}${token}` : token;
      if (current && measure(next) > width) { lines.push(current); current = token; }
      else current = next;
    }
    if (current) lines.push(current);
  }
  return lines;
}
