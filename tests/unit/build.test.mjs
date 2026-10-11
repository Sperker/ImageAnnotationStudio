/**
 * @file Dependency-free Node.js unit tests for the offline distribution.
 * @description Enforces the template version contract, zero-network output,
 * build reproducibility, localized dictionaries, supported limits and project
 * import / rendering safety invariants. Run after npm run build via npm test.
 *
 * Table of contents:
 * 01. Source and compiled-output helpers
 * 02. Version and standalone packaging checks
 * 03. Determinism and localization checks
 * 04. Configuration and import safety checks
 * 05. Fresh-session English language contract
 * 06. GitHub repository footer link
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
/**
 * ==========================================================================
 * 01. Source and compiled-output helpers
 * ==========================================================================
 */
/** @type {string} Absolute project root derived from this test file. */
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
/** Read source files as UTF-8. @param {string} p @returns {string} */
const read=p=>readFileSync(resolve(root,p),'utf8');
/** Fetch the authoritative HTML template. @returns {string} */
const template=()=>read('src/template.html');
/** Parse and assert a unique studio-version meta tag. @returns {string} */
const buildVersion=()=>{
  const matches=[...template().matchAll(/<meta\s+name="studio-version"\s+content="([^"]+)"\s*>/g)];
  assert.equal(matches.length,1,'Exactly one studio version must be in src/template.html');
  return matches[0][1];
};
/** Derive expected dist path solely from the template version. @returns {string} */
const outputFile=()=>`dist/Image Annotation Studio v${buildVersion()}.html`;
/** Read the generated, self-contained browser application. @returns {string} */
const compiled=()=>read(outputFile());
/**
 * ==========================================================================
 * 02. Version and standalone packaging checks
 * ==========================================================================
 */
/**
 * Verify filename, meta version and title agree.
 * @description Rejects invalid or duplicate version markers and ensures the output embeds the exact version.
 */
test('distribution filename and document title use the template build version',()=>{
  assert.match(buildVersion(),/^\d+(?:\.\d+){1,2}$/);
  assert.match(template(),/<title>Image Annotation Studio v<!-- BUILD:VERSION --><\/title>/);
  assert.match(compiled(),new RegExp(`<title>Image Annotation Studio v${buildVersion().replace(/\./g,'\\.') }<\/title>`));
  assert.match(compiled(),new RegExp(`<meta name="studio-version" content="${buildVersion().replace(/\./g,'\\.')}"`));
});
/**
 * Ensure that the release is genuinely self-contained.
 * @description Checks one inline CSS/script block, no unresolved tokens or external script/stylesheet URLs and valid JavaScript syntax.
 */
test('compiled deliverable is a standalone HTML document',()=>{
  const html=compiled();
  assert.match(html,/<!doctype html>/i);
  assert.equal((html.match(/<style>/g)||[]).length,1);
  assert.equal((html.match(/<script>/g)||[]).length,1);
  assert.doesNotMatch(html,/<!--|__STUDIO_/);
  assert.doesNotMatch(html,/<script\b[^>]+src\s*=/i);
  assert.doesNotMatch(html,/<link\b[^>]+href\s*=|@import\s+url\s*\(/i);
  assert.doesNotMatch(html,/fonts\.googleapis|cdn\.jsdelivr|unpkg\.com/i);
  const script=html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
  assert.doesNotThrow(()=>new Script(script));
});
/**
 * ==========================================================================
 * 03. Determinism and localization checks
 * ==========================================================================
 */
/**
 * Ensure source-to-HTML compilation is deterministic.
 * @description Runs the compiler again and compares the SHA-256 digest of the generated HTML.
 */
test('build output is byte-for-byte reproducible',()=>{
  const before=createHash('sha256').update(compiled()).digest('hex');
  const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(createHash('sha256').update(compiled()).digest('hex'),before);
});
/**
 * Ensure English and German dictionaries have matching keys.
 * @description Rejects missing translations and accidental re-introduction of inactive language menu entries.
 */
test('DE/EN localization keys match; no Hungarian in active languages',()=>{
  const de=JSON.parse(read('src/i18n/de.json'));
  const en=JSON.parse(read('src/i18n/en.json'));
  assert.deepEqual(Object.keys(de).sort(),Object.keys(en).sort());
  assert.ok(Object.keys(de).length>50);
  assert.deepEqual([...compiled().split('<script>')[0].matchAll(/data-language="([^"]+)"/g)].map(m=>m[1]),['en','de']);
});
/**
 * ==========================================================================
 * 04. Configuration and import safety checks
 * ==========================================================================
 */
/**
 * Protect documented image and JPEG limits from accidental changes.
 * @description Verifies conservative pixel/file limits and default tools and JPEG compression settings.
 */
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
/**
 * Assert key import validation and native-image geometry functions ship.
 * @description In particular validation must occur before commitImage so malformed ZIPs cannot overwrite the current project.
 */
test('project ZIP import safety and original-resolution rendering remain present',()=>{
  const html=compiled();
  for (const x of ['function readZip','function validateProject','function prepareImage','function importProject','function projectSnapshot','function undo','function redo','function render','const MAX_EXPORT_PIXELS']){
    assert.ok(html.includes(x),`Missing ${x}`);
  }
  assert.ok(html.indexOf('validateProject(doc,files)') < html.indexOf('commitImage(prepared)',html.indexOf('async function importProject')));
});

/**
 * ==========================================================================
 * 05. Fresh-session English language contract
 * ==========================================================================
 */
/**
 * Verify the initial HTML and runtime state begin in English consistently.
 * @description German is still an available choice; project ZIP imports may
 * explicitly restore their saved language instead of using this default.
 */
test('fresh session starts in English in template and compiled app',()=>{
  assert.match(template(),/<html lang="en">/);
  assert.match(template(),/<option value="en" selected>EN<\/option>/);
  assert.match(template(),/data-language="en" aria-selected="true"/);
  assert.match(read('src/js/app.js'),/lang:'en'/);
  assert.match(compiled(),/<html lang="en">/);
  assert.match(compiled(),/lang:'en'/);
});

/**
 * ==========================================================================
 * 06. GitHub repository footer link
 * ==========================================================================
 */
/**
 * Ensure the footer exposes a safe, localized GitHub download link.
 * @description Checks the bundled offline markup, its inline brand icon and
 * both language dictionary entries without fetching anything from the network.
 */
test('footer provides a localized GitHub repository download link',()=>{
  const html=compiled();
  assert.match(html,/<footer id="bottom">[\s\S]*?<span data-t="footer">/);
  assert.match(html,/<a id="githubProjectLink" href="https:\/\/github\.com\/Sperker\/ImageAnnotationStudio" target="_blank" rel="noopener noreferrer">/);
  assert.match(html,/<svg[^>]+aria-hidden="true"><path d="M8 0C3\.58/);
  assert.match(html,/<span data-t="githubDownload">Download this project on GitHub<\/span>/);
  const en=JSON.parse(read('src/i18n/en.json'));
  const de=JSON.parse(read('src/i18n/de.json'));
  assert.equal(en.githubDownload,'Download this project on GitHub');
  assert.equal(de.githubDownload,'Dieses Projekt auf GitHub herunterladen');
});
