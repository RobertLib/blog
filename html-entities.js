// HTML entity decoding shared by build.js and seo-validate.js

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  // Characters that can hide a URL scheme ("javascript&colon;")
  colon: ":",
  tab: "\t",
  newline: "\n",
};

// Like a browser, a numeric reference to no valid character (zero, a
// surrogate or beyond U+10FFFF) gives U+FFFD; String.fromCodePoint would
// throw instead and fail the build over one typo.
function fromCodePoint(codePoint) {
  const valid =
    codePoint > 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff);
  return String.fromCodePoint(valid ? codePoint : 0xfffd);
}

// Decodes numeric and common named entities; unknown ones are left as-is.
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) =>
      Object.hasOwn(NAMED_ENTITIES, name.toLowerCase())
        ? NAMED_ENTITIES[name.toLowerCase()]
        : match
    );
}

module.exports = { decodeEntities };
