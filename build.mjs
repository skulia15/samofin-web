// Builds dist/ from src/: English page as authored, Icelandic page at /is/.
// Translatable bits are marked in src/index.html:
//   data-i18n="key"        replaces the element's text (plain text only, no nested tags)
//   data-i18n-<attr>="key" replaces that attribute's value
// Markers are stripped from the output. Translations live in src/is.json.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SRC = 'src';
const DIST = 'dist';

const template = readFileSync(`${SRC}/index.html`, 'utf8');
const is = JSON.parse(readFileSync(`${SRC}/is.json`, 'utf8'));

const TEXT_RE = /<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([^<]*)<\/\1>/g;
const TAG_RE = /<[a-z][^>]*\sdata-i18n-[^>]*>/g;
const ATTR_MARKER_RE = /\sdata-i18n-([a-z-]+)="([^"]+)"/g;

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

// Every key in the template must be translated, and every translation used.
const used = new Set();
for (const m of template.matchAll(TEXT_RE)) used.add(m[3]);
for (const tag of template.match(TAG_RE) ?? []) {
  for (const m of tag.matchAll(ATTR_MARKER_RE)) used.add(m[2]);
}
const missing = [...used].filter((k) => !(k in is));
const unused = Object.keys(is).filter((k) => !used.has(k));
if (missing.length || unused.length) {
  console.error({ missing, unused });
  process.exit(1);
}

function render(dict) {
  let html = template.replace(TEXT_RE, (_, tag, before, key, after, text) =>
    `<${tag}${before}${after}>${dict ? escText(dict[key]) : text}</${tag}>`,
  );
  html = html.replace(TAG_RE, (tag) => {
    for (const [, attr, key] of tag.matchAll(ATTR_MARKER_RE)) {
      if (!dict) continue;
      const attrRe = new RegExp(`(\\s${attr}=")[^"]*(")`);
      if (!attrRe.test(tag)) throw new Error(`data-i18n-${attr}="${key}" has no ${attr} attribute`);
      tag = tag.replace(attrRe, `$1${escAttr(dict[key])}$2`);
    }
    return tag.replace(ATTR_MARKER_RE, '');
  });
  if (html.includes('data-i18n')) throw new Error('unprocessed data-i18n marker');
  return html.replace('<!--faq-jsonld-->', faqJsonLd(html));
}

// FAQPage structured data built from the rendered #faq section, so it always matches the page.
function faqJsonLd(html) {
  const section = html.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];
  if (!section) throw new Error('no #faq section');
  const unescape = (s) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const mainEntity = [...section.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map(([, q, a]) => ({
    '@type': 'Question',
    name: unescape(q),
    acceptedAnswer: { '@type': 'Answer', text: unescape(a) },
  }));
  if (!mainEntity.length) throw new Error('no FAQ entries found');
  const json = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity }, null, 2);
  return `<script type="application/ld+json">\n${json.replace(/</g, '\\u003c')}\n</script>`;
}

rmSync(DIST, { recursive: true, force: true });
cpSync(SRC, DIST, {
  recursive: true,
  filter: (path) => ![`${SRC}/index.html`, `${SRC}/is.json`].includes(path),
});
writeFileSync(`${DIST}/index.html`, render(null));
mkdirSync(`${DIST}/is`, { recursive: true });
writeFileSync(`${DIST}/is/index.html`, render(is));
console.log(`built ${DIST}/index.html and ${DIST}/is/index.html (${used.size} keys)`);
