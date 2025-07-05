
// index.js
//
// This script processes a dev.to articles export (articles.json) and does the following for each article:
//   - Creates a directory matching the article's `path` property.
//   - Downloads all images referenced in the article (cover_image, social_image, and any images in body_markdown)
//     into that directory, skipping downloads if the file already exists.
//   - Saves the full article as article.json in the same directory.
//   - Generates a Markdown file (article.md) in the same directory, with:
//       - All image URLs in the markdown replaced with local filenames.
//       - A YAML frontmatter header containing article metadata (title, date, tags, cover image, etc).
//
// Requirements:
//   - No dependencies or package.json required.
//   - Run with: bun downloadimages.js
//   - Designed for Bun (uses top-level await and ES6 modules).
//
// Author: Calum Knott
// Date: 2025-07-05

import { promises as fs } from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const articlesPath = path.join(import.meta.dir, 'articles.json');

// Recursively create a directory if it doesn't exist
const mkdirp = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

// Download a file from a URL to a destination path
const download = (url, dest) => new Promise((resolve, reject) => {
  const proto = url.startsWith('https') ? https : http;
  const file = fs.createWriteStream(dest);
  proto.get(url, (response) => {
    if (response.statusCode !== 200) {
      file.close();
      fs.unlink(dest).catch(() => {});
      return reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
    }
    response.pipe(file);
    file.on('finish', () => file.close(resolve));
  }).on('error', (err) => {
    file.close();
    fs.unlink(dest).catch(() => {});
    reject(err);
  });
});

// Extract all image URLs from article fields and markdown
const extractImageUrls = (article) => {
  const urls = [];
  if (article.cover_image) urls.push(article.cover_image);
  if (article.social_image) urls.push(article.social_image);
  if (article.body_markdown) {
    // Match ![alt](url) and ![](url)
    const regex = /!\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = regex.exec(article.body_markdown)) !== null) {
      urls.push(match[1]);
    }
  }
  return urls.filter(Boolean);
};

// Main logic: process all articles
const articles = JSON.parse(await fs.readFile(articlesPath, 'utf8'));
for (const article of articles) {
  if (!article.path) continue;
  const dir = path.join(import.meta.dir, article.path);
  await mkdirp(dir);

  // Save the article as article.json
  await fs.writeFile(path.join(dir, 'article.json'), JSON.stringify(article, null, 2));

  // Download images and build a map of url -> local filename
  const imageUrls = extractImageUrls(article);
  const urlToLocal = {};
  for (const url of imageUrls) {
    try {
      const urlObj = new URL(url);
      const filename = path.basename(urlObj.pathname);
      const dest = path.join(dir, filename);
      urlToLocal[url] = filename;
      try {
        await fs.access(dest);
        console.log(`Already downloaded: ${dest}`);
      } catch {
        console.log(`Downloading ${url} -> ${dest}`);
        await download(url, dest);
      }
    } catch (e) {
      console.warn(`Failed to download ${url}: ${e.message}`);
    }
  }

  // Generate markdown with YAML frontmatter and local image references
  if (article.body_markdown) {
    // Build YAML frontmatter
    const header = [
      '---',
      `title: ${JSON.stringify(article.title || '')}`,
      article.published_at ? `date: ${JSON.stringify(article.published_at)}` : '',
      article.tags ? `tags: ${JSON.stringify(article.tags)}` : '',
      article.cover_image ? `cover_image: ${JSON.stringify(urlToLocal[article.cover_image] || article.cover_image)}` : '',
      article.social_image ? `social_image: ${JSON.stringify(urlToLocal[article.social_image] || article.social_image)}` : '',
      article.canonical_url ? `canonical_url: ${JSON.stringify(article.canonical_url)}` : '',
      article.path ? `path: ${JSON.stringify(article.path)}` : '',
      '---',
      ''
    ].filter(Boolean).join('\n');

    // Replace image URLs in markdown with local filenames
    const localMd = article.body_markdown.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, url) => {
      const local = urlToLocal[url] || url;
      return match.replace(url, local);
    });
    await fs.writeFile(path.join(dir, 'article.md'), header + localMd);
  }
}
