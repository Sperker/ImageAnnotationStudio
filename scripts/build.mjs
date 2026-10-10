#!/usr/bin/env node
/** Dependency-free, deterministic offline HTML build. Requires Node.js 20+. */
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const get=async file=>readFile(resolve(root,file),'utf8');
const config=JSON.parse(await get('src/config/app.json'));
const de=JSON.parse(await get('src/i18n/de.json'));
const en=JSON.parse(await get('src/i18n/en.json'));
const html=await get('src/template.html');
const css=await get('src/css/styles.css');
// The HTML template is authoritative for the distributed version and filename.
const versionTags=[...html.matchAll(/<meta\s+name=["']studio-version["']\s+content=["']([^"']+)["']\s*\/?\s*>/gi)];
if (versionTags.length!==1) throw new Error('Exactly one <meta name="studio-version" content="..."> is required');
const buildVersion=versionTags[0][1];
if (!/^\d+(?:\.\d+){1,2}$/.test(buildVersion)) throw new Error(`Invalid build version: ${buildVersion}`);
const versionMarker='<!-- BUILD:VERSION -->';
if (html.split(versionMarker).length!==2) throw new Error('Exactly one build version marker is required in the template');
// Developer comments are deliberately omitted from the distributable.
const stripCssComments=source=>source.replace(/\/\*[\s\S]*?\*\//g,'');
const stripJsDoc=source=>source.replace(/^\s*\/\*\*[\s\S]*?\*\//gm,'');
let js=await get('src/js/app.js');
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
const out=resolve(root,'dist',`Image Annotation Studio v${buildVersion}.html`);
await mkdir(dirname(out),{recursive:true});
await writeFile(out,result,'utf8');
console.log(`Built ${out} (${Buffer.byteLength(result)} bytes)`);
