// Builds dist/ from src/: each page in English as authored, and in Icelandic under /is/.
// Pages are listed in PAGES. Translatable bits are marked in their templates:
//   data-i18n="key"        replaces the element's text (plain text only, no nested tags)
//   data-i18n-<attr>="key" replaces that attribute's value
// Markers are stripped from the output. Translations for all pages live in src/is.json.
// Other tokens in templates:
//   <!--include:name-->     inlines src/partials/name, indented like the marker
//   __PATH__                this page's path in the current language
//   __PATH_EN__, __PATH_IS__  this page's path in each language
//   __LINK:id__             another page's path in the current language
//   __BUILD_DATE__          the last commit date
// sitemap.xml is generated from PAGES.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const SRC = 'src';
const DIST = 'dist';
const ORIGIN = 'https://samofin.com';

const PAGES = [
  { id: 'home', template: 'index.html', en: '/', is: '/is/' },
  {
    id: 'sharepoint',
    template: 'pages/autodesk-forma-to-sharepoint.html',
    en: '/autodesk-forma-to-sharepoint/',
    is: '/is/autodesk-forma-i-sharepoint/',
  },
];

const is = JSON.parse(readFileSync(`${SRC}/is.json`, 'utf8'));

// English strings that live outside the HTML templates (site JSON-LD). Icelandic overrides them.
const en = {
  'jsonld.app.description':
    'Copies the latest drawings, models and documents from Forma Data Management (formerly Autodesk Docs, Autodesk Construction Cloud) to Procore, AjourBox and SharePoint. It has read-only access to Autodesk, logs every copy and runs in the EU.',
  'jsonld.founder.jobTitle': 'Software developer',
  'jsonld.video.name': 'How Samofin Connector works',
  'jsonld.video.description':
    'Shows how Samofin Connector copies new revisions from Autodesk Forma to Procore, AjourBox and SharePoint.',
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

const INCLUDE_RE = /^([ \t]*)<!--include:([\w.-]+)-->$/gm;
const TEXT_RE = /<(\w+)([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([^<]*)<\/\1>/g;
const TAG_RE = /<[a-z][^>]*\sdata-i18n-[^>]*>/g;
const ATTR_MARKER_RE = /\sdata-i18n-([a-z-]+)="([^"]+)"/g;

const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

const loadTemplate = (file) =>
  readFileSync(`${SRC}/${file}`, 'utf8').replace(INCLUDE_RE, (_, indent, name) =>
    readFileSync(`${SRC}/partials/${name}`, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n'),
  );
for (const page of PAGES) page.html = loadTemplate(page.template);

// Every key in a template must be translated, and every translation used.
const used = new Set(Object.keys(en));
for (const { html } of PAGES) {
  for (const m of html.matchAll(TEXT_RE)) used.add(m[3]);
  for (const tag of html.match(TAG_RE) ?? []) {
    for (const m of tag.matchAll(ATTR_MARKER_RE)) used.add(m[2]);
  }
}
const missing = [...used].filter((k) => !(k in is));
const unused = Object.keys(is).filter((k) => !used.has(k));
if (missing.length || unused.length) {
  console.error({ missing, unused });
  process.exit(1);
}

function render(page, lang) {
  const dict = lang === 'is' ? is : null;
  let html = page.html.replace(TEXT_RE, (_, tag, before, key, after, text) =>
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
  if (html.includes('data-i18n')) throw new Error(`${page.template}: unprocessed data-i18n marker`);
  if (!html.includes('__BUILD_DATE__')) throw new Error(`${page.template}: no __BUILD_DATE__ token`);
  html = html
    .replaceAll('__BUILD_DATE__', buildDate)
    .replaceAll('__PATH_EN__', page.en)
    .replaceAll('__PATH_IS__', page.is)
    .replaceAll('__PATH__', page[lang])
    .replace(/__LINK:([\w-]+)__/g, (_, id) => {
      const target = PAGES.find((p) => p.id === id);
      if (!target) throw new Error(`${page.template}: no page "${id}"`);
      return target[lang];
    });
  if (/__[A-Z_]+__/.test(html)) throw new Error(`${page.template}: unknown token ${html.match(/__[A-Z_]+__/)[0]}`);
  return html
    .replace('<!--site-jsonld-->', () => siteJsonLd(page, lang))
    .replace('<!--video-jsonld-->', () => videoJsonLd(dict ?? en))
    .replace('<!--faq-jsonld-->', () => faqJsonLd(html));
}

const jsonLdScript = (data) =>
  `<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}\n</script>`;

const unescape = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// WebSite, Organization and SoftwareApplication on every page, plus a breadcrumb on pages other
// than home. Same on all pages apart from the translated strings.
function siteJsonLd(page, lang) {
  const dict = lang === 'is' ? is : en;
  const home = PAGES.find((p) => p.id === 'home');
  const graph = [
    {
      '@type': 'WebSite',
      '@id': `${ORIGIN}/#website`,
      name: 'Samofin Tækni',
      alternateName: ['Samofin', 'samofin.com'],
      url: `${ORIGIN}/`,
      inLanguage: ['en', 'is'],
      publisher: { '@id': `${ORIGIN}/#org` },
    },
    {
      '@type': 'Organization',
      '@id': `${ORIGIN}/#org`,
      name: 'Samofin Tækni',
      url: `${ORIGIN}/`,
      logo: `${ORIGIN}/apple-touch-icon.png`,
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
      url: ORIGIN + home[lang],
      inLanguage: lang,
      publisher: { '@id': `${ORIGIN}/#org` },
    },
  ];
  if (page !== home) {
    const h1 = page.html.match(/<h1[^>]*>([^<]*)<\/h1>/);
    if (!h1) throw new Error(`${page.template}: no <h1> for the breadcrumb`);
    const name = lang === 'is' ? is[h1[0].match(/data-i18n="([^"]+)"/)?.[1]] : unescape(h1[1]);
    if (!name) throw new Error(`${page.template}: <h1> needs a data-i18n key`);
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Samofin Connector', item: ORIGIN + home[lang] },
        { '@type': 'ListItem', position: 2, name, item: ORIGIN + page[lang] },
      ],
    });
  }
  return jsonLdScript({ '@context': 'https://schema.org', '@graph': graph });
}

// The hero explainer on the home page. The video itself is in English on both pages.
const videoJsonLd = (dict) =>
  jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: dict['jsonld.video.name'],
    description: dict['jsonld.video.description'],
    thumbnailUrl: `${ORIGIN}/samofin-construction-sync-poster.jpg`,
    contentUrl: `${ORIGIN}/samofin-construction-sync.mp4`,
    uploadDate: '2026-10-22',
    duration: 'PT30S',
    inLanguage: 'en',
    publisher: { '@id': `${ORIGIN}/#org` },
  });

// FAQPage structured data built from the rendered #faq section, so it always matches the page.
function faqJsonLd(html) {
  const section = html.match(/<section id="faq"[\s\S]*?<\/section>/)?.[0];
  if (!section) throw new Error('no #faq section');
  const mainEntity = [...section.matchAll(/<dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map(([, q, a]) => ({
    '@type': 'Question',
    name: unescape(q),
    acceptedAnswer: { '@type': 'Answer', text: unescape(a) },
  }));
  if (!mainEntity.length) throw new Error('no FAQ entries found');
  return jsonLdScript({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity });
}

function sitemap() {
  const alternates = (page) =>
    [
      ['en', page.en],
      ['is', page.is],
      ['x-default', page.en],
    ]
      .map(([hreflang, path]) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${ORIGIN}${path}"/>`)
      .join('\n');
  const urls = PAGES.flatMap((page) =>
    [page.en, page.is].map(
      (path) => `  <url>\n    <loc>${ORIGIN}${path}</loc>\n    <lastmod>${buildDate}</lastmod>\n${alternates(page)}\n  </url>`,
    ),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

const NOT_COPIED = new Set([`${SRC}/is.json`, `${SRC}/partials`, ...PAGES.map((p) => `${SRC}/${p.template.split('/')[0]}`)]);
rmSync(DIST, { recursive: true, force: true });
cpSync(SRC, DIST, { recursive: true, filter: (path) => !NOT_COPIED.has(path) });
writeFileSync(`${DIST}/sitemap.xml`, sitemap());
for (const page of PAGES) {
  for (const lang of ['en', 'is']) {
    const dir = DIST + page[lang];
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}index.html`, render(page, lang));
  }
}
console.log(`built ${PAGES.length * 2} pages (${used.size} keys, date ${buildDate})`);
