import sitemap, { type SitemapItem } from '@astrojs/sitemap';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'astro/config';
import {
  DEFAULT_LOCALE,
  LANDING_LOCALES,
  stripLocaleFromPath,
} from './app/i18n';

// Production canonical origin. Used by Astro for `Astro.site`, by
// `@astrojs/sitemap` for every URL it emits, and by `index.astro` to
// build the `<link rel="canonical">` / `og:url` tags.
//
// `open-design.ai` is the live domain bound to the Cloudflare Pages
// project (`open-design-landing`); the env override exists so preview
// builds (Cloudflare Pages preview deployments, local previews on a
// different host) can stamp their own URL without forking the config.
const site = process.env.OD_LANDING_SITE ?? 'https://open-design.ai';
const sitemapLocales = Object.fromEntries(
  LANDING_LOCALES.map((locale) => [locale.code, locale.htmlLang]),
);
const changefreq = {
  daily: 'daily' as SitemapItem['changefreq'],
  weekly: 'weekly' as SitemapItem['changefreq'],
  monthly: 'monthly' as SitemapItem['changefreq'],
};

// Read blog post dates at config time so the sitemap can include lastmod.
const blogDir = join(import.meta.dirname, 'app/content/blog');
const blogDates = new Map<string, string>();
for (const file of readdirSync(blogDir)) {
  if (!file.endsWith('.md') || file.startsWith('_')) continue;
  const raw = readFileSync(join(blogDir, file), 'utf-8');
  const match = raw.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m);
  if (match) {
    const slug = file.replace(/\.md$/, '');
    blogDates.set(`/blog/${slug}/`, match[1]!);
  }
}

export default defineConfig({
  output: 'static',
  site,
  srcDir: './app',
  outDir: './out',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: sitemapLocales,
      },
      namespaces: {
        xhtml: true,
      },
      // `/og/` is a screenshot surface for the 1200x630 Open Graph
      // image — it already carries `<meta name="robots" content="noindex">`
      // and is `Disallow`-ed from `public/robots.txt`. Filtering it
      // out of the sitemap keeps the index strictly canonical pages.
      filter: (page) => !page.includes('/og/'),
      serialize(item: SitemapItem) {
        const path = stripLocaleFromPath(new URL(item.url).pathname).pathname;
        if (path === '/') {
          item.priority = 1.0;
          item.changefreq = changefreq.daily;
        } else if (path === '/blog/') {
          item.priority = 0.9;
          item.changefreq = changefreq.daily;
        } else if (path.startsWith('/blog/')) {
          item.priority = 0.8;
          item.changefreq = changefreq.weekly;
          const date = blogDates.get(path);
          if (date) item.lastmod = date;
        } else if (
          // High-intent landing pages — these are the brand defense
          // and commercial-intent surfaces from
          // growth/seo-opendesigner-analysis.md. They should be
          // crawled more often than the catalog and prioritized
          // above generic detail pages.
          path === '/official/' ||
          path === '/quickstart/' ||
          path === '/compare/' ||
          path === '/agents/' ||
          path === '/alternatives/claude-design/'
        ) {
          item.priority = 0.9;
          item.changefreq = changefreq.weekly;
        } else if (
          path === '/skills/' ||
          path === '/systems/' ||
          path === '/templates/' ||
          path === '/craft/' ||
          path === '/plugins/'
        ) {
          item.priority = 0.7;
          item.changefreq = changefreq.weekly;
        } else {
          item.priority = 0.5;
          item.changefreq = changefreq.monthly;
        }
        return item;
      },
    }),
  ],
});
