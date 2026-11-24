import test from "node:test";
import assert from "node:assert/strict";
import { wrapPosterTextLines } from "./poster-typography.ts";

test("Chinese portrait never breaks before its final punctuation or loses text", () => {
  const value = "你是耳朵很有好奇心，不肯只住在一种声音里的人。";
  for (const fontSize of [36, 35, 34, 33, 32, 31, 30]) {
    const lines = wrapPosterTextLines(value, 410, text => Array.from(text).length * fontSize);
    assert.equal(lines.join(""), value);
    assert.ok(lines.every(line => !/^[，。？！；：、）】》」』”’]/u.test(line)));
    assert.ok(lines.every(line => Array.from(line).length * fontSize <= 410));
  }
  assert.equal(wrapPosterTextLines(value, 410, text => Array.from(text).length * 34).length, 2);
});

test("Chinese quotes stay with their content and English keeps word boundaries", () => {
  const quoted = "你把《熟悉的旋律》，听成生活的背景。";
  const lines = wrapPosterTextLines(quoted, 100, text => Array.from(text).length * 20);
  assert.equal(lines.join(""), quoted);
  assert.ok(lines.every(line => !/[（【《「『“‘]$/u.test(line) && !/^[，。？！；：、）】》」』”’]/u.test(line)));
  assert.deepEqual(wrapPosterTextLines("Your music,\non record.", 200, text => text.length * 10), ["Your music,", "on record."]);
});
