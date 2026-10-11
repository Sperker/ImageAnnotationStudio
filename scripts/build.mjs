#!/usr/bin/env node
/**
 * @file Deterministic Image Annotation Studio compiler (Node.js >= 20).
 * @description
 * This script packages the repository into a single offline HTML document.
 * It never downloads packages or assets. Its output depends only on source files.
 *
 * Core responsibilities:
 * - Read source HTML, CSS, JSON configuration and EN/DE dictionaries.
 * - Validate the version declared by the HTML template and its build markers.
 * - Inject safety limits, palette defaults, JPEG qualities and translations.
 * - Strip JSDoc and stylesheet comments from the distributed application.
 * - Write dist/Image Annotation Studio v<version>.html reproducibly.
 *
 * Table of contents:
 * 01. Locate source tree and load build-time dependencies
 * 02. Read version and validate the template contract
 * 03. Prepare minified documentation-free source fragments
 * 04. Inject configuration and compile one offline HTML
 * 05. Write versioned output to dist/
 *
 * @see docs/SOURCE_GUIDE.md
 * @see src/template.html
 */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
/**
 * ==========================================================================
 * 01. Locate source tree and load build-time dependencies
 * ==========================================================================
 */
/** @type {string} Absolute repository root, independent of caller working directory. */
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
/**
 * Read a UTF-8 source file relative to the repository root.
 * @param {string} file - Relative path under the project directory.
 * @returns {Promise<string>} Original source text.
 * @throws {Error} If the source file is unavailable or cannot be decoded.
 */
const get=async file=>readFile(resolve(root,file),'utf8');
const config=JSON.parse(await get('src/config/app.json'));
const de=JSON.parse(await get('src/i18n/de.json'));
const en=JSON.parse(await get('src/i18n/en.json'));
const html=await get('src/template.html');
const css=await get('src/css/styles.css');
// The HTML template is authoritative for the distributed version and filename.
/**
 * ==========================================================================
 * 02. Read version and validate the template contract
 * ==========================================================================
 * The meta tag in the template is the sole source of the build version.
 */
const versionTags=[...html.matchAll(/<meta\s+name=["']studio-version["']\s+content=["']([^"']+)["']\s*\/?\s*>/gi)];
if (versionTags.length!==1) throw new Error('Exactly one <meta name="studio-version" content="..."> is required');
const buildVersion=versionTags[0][1];
if (!/^\d+(?:\.\d+){1,2}$/.test(buildVersion)) throw new Error(`Invalid build version: ${buildVersion}`);
const versionMarker='<!-- BUILD:VERSION -->';
if (html.split(versionMarker).length!==2) throw new Error('Exactly one build version marker is required in the template');
// Developer comments are deliberately omitted from the distributable.
/**
 * ==========================================================================
 * 03. Prepare documentation-free source fragments
 * ==========================================================================
 */
/**
 * Remove stylesheet comments, preserving the order and declarations of CSS.
 * @param {string} source - Documented developer stylesheet.
 * @returns {string} CSS without comments for the bundled release.
 */
const stripCssComments=source=>source.replace(/\/\*[\s\S]*?\*\//g,'');
/**
 * Remove JSDoc blocks from the runtime bundle, preserving executable JS.
 * Ordinary runtime comments and code are left unchanged.
 * @param {string} source - Documented application JavaScript.
 * @returns {string} Runtime JavaScript with JSDoc removed.
 */
const stripJsDoc=source=>source.replace(/^\s*\/\*\*[\s\S]*?\*\//gm,'');
/**
 * Remove developer-only HTML comments after template markers have been resolved.
 * @param {string} source - Compiled HTML document.
 * @returns {string} Release HTML without table-of-contents comments.
 */
const stripHtmlComments=source=>source.replace(/<!--[\s\S]*?-->/g,'');
let js=await get('src/js/app.js');
/**
 * ==========================================================================
 * 04. Inject configuration and compile one offline HTML
 * ==========================================================================
 * Build tokens are replaced exactly once from project-owned JSON data.
 * Missing tokens and unmatched translation keys are fatal build errors.
 */
const injection={
  '__STUDIO_DEFAULTS__':config.defaults,
  '__STUDIO_PALETTE__':config.palette,
  '__STUDIO_JPEG_QUALITIES__':config.jpeg.quality,
  '__STUDIO_JPEG_DEFAULT__':config.jpeg.defaultCompression,
  '__STUDIO_TRANSLATIONS__':{de,en}
};
for (const [key,value] of Object.entries(config.limits)) injection[`__STUDIO_${key}__`]=value;
for (const [token,value] of Object.entries(injection)) {
  if (!js.includes(token)) throw new Error(`Missing build token ${token}`);
  js=js.replace(token,JSON.stringify(value));
}
js=stripJsDoc(js);
if (/__STUDIO_[A-Z_]+__/.test(js)) throw new Error('Unresolved build token');
if (!html.includes('<!-- BUILD:CSS -->') || !html.includes('<!-- BUILD:JS -->')) throw new Error('Missing template markers');
if (Object.keys(de).sort().join('|')!==Object.keys(en).sort().join('|')) throw new Error('German / English translation keys differ');
const result=html.replace(versionMarker,buildVersion)
                 .replace('<!-- BUILD:CSS -->',`<style>\n${stripCssComments(css).trimEnd()}\n</style>`)
                 .replace('<!-- BUILD:JS -->',`<script>\n${js.trimEnd()}\n</script>`);
const release=stripHtmlComments(result);
/**
 * ==========================================================================
 * 05. Write versioned output to dist/
 * ==========================================================================
 * The output remains usable via file:// with no network or runtime build step.
 */
const out=resolve(root,'dist',`Image Annotation Studio v${buildVersion}.html`);
await mkdir(dirname(out),{recursive:true});
await writeFile(out,release,'utf8');
console.log(`Built ${out} (${Buffer.byteLength(release)} bytes)`);
