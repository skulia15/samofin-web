// Builds dist/ from src/: English page as authored, Icelandic page at /is/.
// Translatable bits are marked in src/index.html:
//   data-i18n="key"        replaces the element's text (plain text only, no nested tags)
//   data-i18n-<attr>="key" replaces that attribute's value
// Markers are stripped from the output. Translations live in src/is.json.
// __BUILD_DATE__ in index.html and sitemap.xml becomes the last commit date.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SRC = 'src';
const DIST = 'dist';

const template = readFileSync(`${SRC}/index.html`, 'utf8');
const is = JSON.parse(readFileSync(`${SRC}/is.json`, 'utf8'));

// English strings that live outside the HTML template (site JSON-LD). Icelandic overrides them.
const en = {
  'jsonld.app.description':
    'Copies the latest drawings, models and documents from Forma Data Management (formerly Autodesk Docs, Autodesk Construction Cloud) to Procore, AjourBox and SharePoint. One-way, fully logged, hosted in the EU.',
  'jsonld.founder.jobTitle': 'Software developer',
};

// Footer title block and sitemap <lastmod>: date of the last commit, or today when not in git.
const buildDate = (() => {
  try {
    return execSync('git log -1 --format=%cs', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
})();
if (!/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) throw new Error(`bad build date: ${buildDate}`);

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
for (const k of Object.keys(en)) used.add(k);
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
  if (!html.includes('__BUILD_DATE__')) throw new Error('no __BUILD_DATE__ token');
  return html
    .replaceAll('__BUILD_DATE__', buildDate)
    .replace('<!--site-jsonld-->', () => siteJsonLd(dict ?? en))
    .replace('<!--faq-jsonld-->', () => faqJsonLd(html));
}

const jsonLdScript = (data) =>
  `<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}\n</script>`;

// WebSite, Organization and SoftwareApplication. Same on both pages apart from the translated strings.
function siteJsonLd(dict) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': 'https://samofin.com/#website',
        name: 'Samofin Tækni',
        alternateName: ['Samofin', 'samofin.com'],
        url: 'https://samofin.com/',
        inLanguage: ['en', 'is'],
        publisher: { '@id': 'https://samofin.com/#org' },
      },
      {
        '@type': 'Organization',
        '@id': 'https://samofin.com/#org',
        name: 'Samofin Tækni',
        url: 'https://samofin.com/',
        logo: 'https://samofin.com/apple-touch-icon.png',
        email: 'hello@samofin.com',
        sameAs: ['https://www.linkedin.com/company/145330138/'],
        founder: {
          '@type': 'Person',
          name: 'Skúli Arnarsson',
          jobTitle: dict['jsonld.founder.jobTitle'],
          email: 'skuli@samofin.com',
          sameAs: ['https://www.linkedin.com/in/skulipardus/'],
        },
        address: { '@type': 'PostalAddress', addressLocality: 'Hafnarfjörður', addressCountry: 'IS' },
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Samofin Connector',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: dict['jsonld.app.description'],
        url: dict['url.self'] ?? 'https://samofin.com/',
        inLanguage: dict['lang'] ?? 'en',
        publisher: { '@id': 'https://samofin.com/#org' },
      },
    ],
  });
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
  return jsonLdScript({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity });
}

rmSync(DIST, { recursive: true, force: true });
cpSync(SRC, DIST, {
  recursive: true,
  filter: (path) => ![`${SRC}/index.html`, `${SRC}/is.json`, `${SRC}/sitemap.xml`].includes(path),
});
writeFileSync(`${DIST}/sitemap.xml`, readFileSync(`${SRC}/sitemap.xml`, 'utf8').replaceAll('__BUILD_DATE__', buildDate));
writeFileSync(`${DIST}/index.html`, render(null));
mkdirSync(`${DIST}/is`, { recursive: true });
writeFileSync(`${DIST}/is/index.html`, render(is));
console.log(`built ${DIST}/index.html and ${DIST}/is/index.html (${used.size} keys, date ${buildDate})`);
