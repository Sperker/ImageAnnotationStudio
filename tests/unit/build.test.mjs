import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const template=()=>read('src/template.html');
const buildVersion=()=>{
  const matches=[...template().matchAll(/<meta\s+name="studio-version"\s+content="([^"]+)"\s*>/g)];
  assert.equal(matches.length,1,'Exactly one studio version must be in src/template.html');
  return matches[0][1];
};
const outputFile=()=>`dist/Image Annotation Studio v${buildVersion()}.html`;
const compiled=()=>read(outputFile());
test('distribution filename and document title use the template build version',()=>{
  assert.match(buildVersion(),/^\d+(?:\.\d+){1,2}$/);
  assert.match(template(),/<title>Image Annotation Studio v<!-- BUILD:VERSION --><\/title>/);
  assert.match(compiled(),new RegExp(`<title>Image Annotation Studio v${buildVersion().replace(/\./g,'\\.') }<\/title>`));
  assert.match(compiled(),new RegExp(`<meta name="studio-version" content="${buildVersion().replace(/\./g,'\\.')}"`));
});
test('compiled deliverable is a standalone HTML document',()=>{
  const html=compiled();
  assert.match(html,/<!doctype html>/i);
  assert.equal((html.match(/<style>/g)||[]).length,1);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.doesNotMatch(html,/<!-- BUILD:|__STUDIO_/);
  assert.doesNotMatch(html,/<script\b[^>]+src\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]+href\s*=|@import\s+url\s*\(/i);
  assert.doesNotMatch(html,/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/i);
  const script=html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
  assert.doesNotThrow(()=>new Script(script));
});
test('build output is byte-for-byte reproducible',()=>{
  const before=createHash('sha256').update(compiled()).digest('hex');
  const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(createHash('sha256').update(compiled()).digest('hex'),before);
});
test('DE/EN localization keys match; no Hungarian in active languages',()=>{
  const de=JSON.parse(read('src/i18n/de.json'));
  const en=JSON.parse(read('src/i18n/en.json'));
  assert.deepEqual(Object.keys(de).sort(),Object.keys(en).sort());
  assert.ok(Object.keys(de).length>50);
  assert.deepEqual([...compiled().split('<script>')[0].matchAll(/data-language="([^"]+)"/g)].map(m=>m[1]),['en','de']);
});
test('image limits and defaults are stored in config',()=>{
  const cfg=JSON.parse(read('src/config/app.json'));
  assert.equal(cfg.limits.MAX_IMAGE_SIDE,16384);
  assert.equal(cfg.limits.MAX_IMAGE_PIXELS,40_000_000);
  assert.equal(cfg.limits.MAX_IMAGE_BYTES,65*1024*1024);
  assert.equal(cfg.defaults.numbering.radius,20);
  assert.equal(cfg.defaults.arrows.width,100);
  assert.equal(cfg.defaults.roi.border,4);
  assert.equal(cfg.jpeg.defaultCompression,'medium');
  assert.deepEqual(cfg.jpeg.quality,{low:0.92,medium:0.8,high:0.6});
});
test('project ZIP import safety and original-resolution rendering remain present',()=>{
  const html=compiled();
  for (const x of ['function readZip','function validateProject','function prepareImage','function importProject','function projectSnapshot','function undo','function redo','function render','const MAX_EXPORT_PIXELS']){
    assert.ok(html.includes(x),`Missing ${x}`);
  }
  assert.ok(html.indexOf('validateProject(doc,files)') < html.indexOf('commitImage(prepared)',html.indexOf('async function importProject')));
});
