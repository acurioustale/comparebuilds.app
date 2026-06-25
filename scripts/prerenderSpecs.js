// ─── Prerender spec landing pages ─────────────────────────────────────────────
//
// Runs after `vite build`. For every implemented class+spec it writes
// dist/<class>/<spec>/index.html — a copy of the built index.html with
// spec-specific <title>/description/canonical/OG tags and a static <main> summary
// inside #root (crawlers see it; React replaces it on mount). Also emits
// sitemap.xml and robots.txt. Hash routing still serves the live app at "/"; these
// are real URLs purely so search engines and link previews have something to read.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const ORIGIN = 'https://comparebuilds.app'

// Read the class index via fs (rather than an import attribute) so the build
// script parses under the same lint config as the rest of the repo.
const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/classes.json'), 'utf8'))

const seg = (slug) => slug.replaceAll('_', '-')
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Replaces the content="" of the <meta> identified by attr/key (single- or multi-line). */
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta\\b[^>]*?\\b${attr}="${key}"[^>]*?\\bcontent=")[^"]*(")`, '')
  return html.replace(re, `$1${escAttr(value)}$2`)
}

function buildPage(template, { title, description, url, summary }) {
  let html = template
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`)
  // Canonical right after the title.
  html = html.replace(/<\/title>/, `</title>\n    <link rel="canonical" href="${escAttr(url)}" />`)
  html = setMeta(html, 'name', 'description', description)
  html = setMeta(html, 'property', 'og:title', title)
  html = setMeta(html, 'property', 'og:description', description)
  html = setMeta(html, 'property', 'og:url', url)
  html = setMeta(html, 'name', 'twitter:title', title)
  html = setMeta(html, 'name', 'twitter:description', description)
  // Static SEO content inside #root; React replaces it for JS visitors.
  html = html.replace('<div id="root"></div>', `<div id="root">${summary}</div>`)
  return html
}

function summaryHtml(cls, spec) {
  const others = cls.specs
    .filter((s) => s.id !== spec.id)
    .map((s) => `<a href="/${seg(cls.name)}/${seg(s.name)}/">${escHtml(s.displayName)}</a>`)
    .join(' · ')
  return [
    '<main style="max-width:680px;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif;color:#c8a84b">',
    `<h1>${escHtml(spec.displayName)} ${escHtml(cls.displayName)} Talent Build Calculator</h1>`,
    spec.description ? `<p>${escHtml(spec.description)}</p>` : '',
    `<p>Build, import and compare ${escHtml(spec.displayName)} ${escHtml(cls.displayName)} talent loadouts side by side on Compare Builds.</p>`,
    others ? `<p>Other ${escHtml(cls.displayName)} specs: ${others}</p>` : '',
    '<p><a href="/">All classes and specs →</a></p>',
    '</main>',
  ].filter(Boolean).join('\n')
}

// ── Run ──────────────────────────────────────────────────────────────────────
const templatePath = path.join(DIST, 'index.html')
if (!fs.existsSync(templatePath)) {
  console.error('prerenderSpecs: dist/index.html not found — run `vite build` first.')
  process.exit(1)
}
const template = fs.readFileSync(templatePath, 'utf8')

const urls = [`${ORIGIN}/`]
let count = 0
for (const cls of classes) {
  if (!cls.implemented) continue
  for (const spec of cls.specs) {
    const url = `${ORIGIN}/${seg(cls.name)}/${seg(spec.name)}/`
    const title = `${spec.displayName} ${cls.displayName} Talent Build Calculator — Compare Builds`
    const description = `Build, import and compare ${spec.displayName} ${cls.displayName} talent loadouts side by side, then share them with a short link.`
    const page = buildPage(template, { title, description, url, summary: summaryHtml(cls, spec) })

    const dir = path.join(DIST, seg(cls.name), seg(spec.name))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'index.html'), page)
    urls.push(url)
    count++
  }
}

// Sitemap + robots.
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')
  + '\n</urlset>\n'
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap)
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`)

console.log(`prerenderSpecs: wrote ${count} spec pages + sitemap.xml + robots.txt`)
