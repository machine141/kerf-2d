// Turn the Vite single-file build into page content for publishing (no html/head/body wrappers).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
const pick = re => (head.match(re) || []).join('\n');
const title = pick(/<title>[\s\S]*?<\/title>/), metas = pick(/<meta name="claude:[^>]*>/g), links = pick(/<link [^>]*>/g);
const styles = pick(/<style>[\s\S]*?<\/style>/g), scripts = pick(/<script[\s\S]*?<\/script>/g);
writeFileSync('dist/kerf-artifact.html', [title, metas, links, styles, body.trim(), scripts].join('\n'));
console.log('dist/kerf-artifact.html', (title + styles + body + scripts).length, 'bytes');
