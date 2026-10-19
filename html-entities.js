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
};

// Decodes numeric and common named entities; unknown ones are left as-is.
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) =>
      Object.hasOwn(NAMED_ENTITIES, name.toLowerCase())
        ? NAMED_ENTITIES[name.toLowerCase()]
        : match
    );
}

module.exports = { decodeEntities };
