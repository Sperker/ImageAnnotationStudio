"""Image Annotation Studio end-to-end regression suite.

Test responsibilities:
- Launch the actual generated offline HTML in the requested Playwright engine.
- Reject browser JavaScript errors and outgoing HTTP/HTTPS requests.
- Verify annotation geometry, history, settings, layer ordering and crop export.
- Round-trip project ZIPs and reject corrupted or malformed archives atomically.
- Decode exported PNG/JPEG images to verify pixels, dimensions and quality.

Table of contents:
01. Local fixtures, synthetic PNG generator and browser setup
02. Editor interaction, geometry and history tests
03. Project ZIP, import safety and image-limit tests
04. JPEG compression, crop, quality and transparency tests
05. Startup language and project language persistence
06. GitHub repository footer link and bilingual label
07. Narrow-screen layer card reflow and footer styling

Run: npm run build && npm run test:e2e
Set STUDIO_BROWSER to chromium, firefox or webkit as needed.
"""
import io
import zipfile
import json
import base64
import os
import re
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = (ROOT / 'src' / 'template.html').read_text(encoding='utf-8')
VERSION_MATCH = re.search(r'<meta\s+name="studio-version"\s+content="([^"]+)"\s*>', TEMPLATE)
if not VERSION_MATCH or not re.fullmatch(r'\d+(?:\.\d+){1,2}', VERSION_MATCH.group(1)):
    raise RuntimeError('src/template.html must provide a valid studio-version meta tag')
ENTRY = ROOT / 'dist' / f'Image Annotation Studio v{VERSION_MATCH.group(1)}.html'
ENGINE = os.getenv('STUDIO_BROWSER', 'chromium')


# ============================================================================
# 01. Local fixtures, synthetic PNG generator and browser setup
# ============================================================================
def make_png(width=640, height=400):
    """Generate a losslessly encoded RGB fixture without Pillow.

    The image is filled with a known gray and assembled from IHDR/IDAT/IEND chunks with valid CRCs.
    """
    def chunk(kind, body):
        """Create one CRC-protected PNG chunk.

        Uses network byte order length and CRC32 as required by the PNG specification.
        """
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    raw = b''.join(b'\x00' + (b'\xee\xee\xee' * width) for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


class StudioRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        """Launch one Playwright browser for this regression class.

        Choose STUDIO_BROWSER; a system Chromium fallback supports restricted Linux test runners.
        """
        cls.play = sync_playwright().start()
        browser_type = getattr(cls.play, ENGINE)
        if ENGINE == 'chromium' and Path('/usr/bin/chromium').exists() and not Path(browser_type.executable_path).exists():
            cls.browser = browser_type.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        else:
            cls.browser = browser_type.launch(headless=True)
        assert ENTRY.is_file(), f'Run npm run build first: {ENTRY}'

    @classmethod
    def tearDownClass(cls):
        """Close the class browser and Playwright driver.

        Releases operating-system resources after tests finish.
        """
        cls.browser.close()
        cls.play.stop()

    def setUp(self):
        """Start a fresh isolated browser context for each test.

        Captures page exceptions and external requests and renders the exact built HTML in memory.
        """
        self.context = self.browser.new_context(accept_downloads=True, viewport={'width': 1280, 'height': 900})
        self.page = self.context.new_page()
        self.errors = []
        self.external_requests = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('request', lambda r: self.external_requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
        # Render the exact built HTML in memory: works even in restricted CI browsers blocking file://.
        self.page.set_content(ENTRY.read_text(encoding='utf8'), wait_until='load')

    def tearDown(self):
        """Fail the test on JavaScript errors or network requests.

        Always closes the per-test browser context, enforcing offline behavior.
        """
        self.assertEqual(self.errors, [], 'Unexpected JS errors')
        self.assertEqual(self.external_requests, [], 'Offline build made external requests')
        self.context.close()

    def state(self, expr):
        """Evaluate a read-only expression against the exposed regression state.

        Avoids coupling every assertion to presentation markup.
        """
        return self.page.evaluate(f'() => {{ const s = window.__studioTest.state; return ({expr}); }}')

    def upload(self):
        """Load the 640x400 synthetic PNG fixture.

        Waits until the browser has decoded and committed the image.
        """
        self.page.locator('#fileInput').set_input_files({'name': 'sample.png', 'mimeType': 'image/png', 'buffer': make_png()})
        self.page.wait_for_function('window.__studioTest.state.loaded')
        self.assertEqual(self.state('s.img.naturalWidth'), 640)

    def click_at(self, x, y):
        """Click a canvas-relative point in CSS pixels.

        Uses the current bounding box instead of assuming a fixed preview position.
        """
        box=self.page.locator('#canvas').bounding_box()
        self.page.mouse.click(box['x']+x,box['y']+y)

    def drag_at(self, x1,y1,x2,y2):
        """Perform a multi-step canvas-relative drag.

        Pointer steps exercise gesture handling, selection and history recording.
        """
        box=self.page.locator('#canvas').bounding_box()
        self.page.mouse.move(box['x']+x1,box['y']+y1)
        self.page.mouse.down()
        self.page.mouse.move(box['x']+x2,box['y']+y2,steps=6)
        self.page.mouse.up()

    # ========================================================================
    # 02. Editor interaction, geometry and history tests
    # ========================================================================
    def test_settings_button_sizes_match_editor_without_widening_dialog(self):
        """Check settings tabs and actions match toolbar button styling.

        Verifies geometry in DE and EN at fixed 565px modal width, plus narrow mobile containment.
        """
        self.upload()
        self.page.set_viewport_size({'width': 728, 'height': 800})
        expected=self.page.locator('#standardBtn').evaluate('''(el) => {
            const s=getComputedStyle(el);
            return [s.fontSize,s.fontWeight,s.lineHeight,s.paddingTop,s.paddingRight,
                    s.paddingBottom,s.paddingLeft,s.borderRadius,el.getBoundingClientRect().height];
        }''')
        for language in ['de', 'en']:
            if language == 'en':
                self.page.locator('#languageToggle').click()
                self.page.locator('#languageMenu [data-language="en"]').click()
            self.page.locator('#settingsButton').click()
            for selector in ['#settingsTabs button', '#settingsSaveButton', '#settingsCancelButton', '#settingsResetButton']:
                actual=self.page.locator(selector).first.evaluate('''(el) => {
                    const s=getComputedStyle(el);
                    return [s.fontSize,s.fontWeight,s.lineHeight,s.paddingTop,s.paddingRight,
                            s.paddingBottom,s.paddingLeft,s.borderRadius,el.getBoundingClientRect().height];
                }''')
                self.assertEqual(actual,expected,selector)
            geometry=self.page.evaluate('''() => {
                const modal=document.querySelector('#settingsPopup').getBoundingClientRect();
                const buttons=[...document.querySelectorAll('#settingsTabs button')].map(e=>e.getBoundingClientRect());
                return {width:modal.width, left:modal.left, right:modal.right,
                        topRow:buttons.every(b=>b.top===buttons[0].top),
                        contained:buttons.every(b=>b.left>=modal.left+20 && b.right<=modal.right-20)};
            }''')
            self.assertEqual(geometry['width'],565)
            self.assertTrue(geometry['topRow'],language)
            self.assertTrue(geometry['contained'],language)
            self.page.locator('#settingsCancelButton').click()

        self.page.set_viewport_size({'width': 360, 'height': 800})
        self.page.locator('#settingsButton').click()
        geometry=self.page.evaluate('''() => {
            const modal=document.querySelector('#settingsPopup').getBoundingClientRect();
            const controls=[...document.querySelectorAll('#settingsTabs button, #settingsActions button')].map(e=>e.getBoundingClientRect());
            return {left:modal.left,right:modal.right,
                    contained:controls.every(b=>b.left>=modal.left && b.right<=modal.right)};
        }''')
        self.assertGreaterEqual(geometry['left'],0)
        self.assertLessEqual(geometry['right'],360)
        self.assertTrue(geometry['contained'])

    def test_initial_state_and_language(self):
        """Check English is the fresh default and German remains selectable.

        Asserts initial document locale, language menu state and translated subtitle in both languages.
        """
        self.assertTrue(self.page.locator('#cont_drop_zone').is_visible())
        self.assertEqual(self.page.locator('#layerContainer').evaluate('(el)=>getComputedStyle(el).display'), 'none')
        self.assertEqual(self.state('s.lang'), 'en')
        self.assertEqual(self.page.locator('html').get_attribute('lang'),'en')
        self.assertIn('Zero-Friction', self.page.locator('#topSubtitle').inner_text())
        self.assertEqual(self.page.locator('#languageToggle').inner_text().strip(),'EN')
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="de"]').click()
        self.assertEqual(self.state('s.lang'), 'de')
        self.assertIn('Reibungslose', self.page.locator('#topSubtitle').inner_text())
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="en"]').click()
        self.assertEqual(self.state('s.lang'), 'en')
        self.assertIn('Zero-Friction', self.page.locator('#topSubtitle').inner_text())
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="de"]').click()
        self.assertEqual(self.state('s.lang'), 'de')

    def test_numbering_delete_renumber_and_history(self):
        """Verify numbered circles remain consecutive after deletion.

        Undo and redo must restore the original numbered sequence and edits.
        """
        self.upload()
        self.page.locator('[data-layer="numbering"]').click()
        self.click_at(80,80); self.click_at(160,80); self.click_at(240,80)
        self.assertEqual(self.state('[...s.items.numbering.map(c=>c.number)]'),[1,2,3])
        self.click_at(160,80)
        self.page.keyboard.press('Delete')
        self.assertEqual(self.state('[...s.items.numbering.map(c=>c.number)]'),[1,2])
        self.page.keyboard.press('Control+z')
        self.assertEqual(self.state('[...s.items.numbering.map(c=>c.number)]'),[1,2,3])
        self.page.keyboard.press('Control+Shift+z')
        self.assertEqual(self.state('[...s.items.numbering.map(c=>c.number)]'),[1,2])

    def test_arrow_move_and_separate_tool_history(self):
        """Ensure moving an arrow is one undoable action.

        Switching to numbering must not mix its undo history with the arrows tool.
        """
        self.upload()
        self.click_at(130,130)
        self.assertEqual(self.state('s.items.arrows.length'),1)
        old_x=self.state('s.items.arrows[0].x')
        self.drag_at(130,130,172,160)
        self.assertGreater(self.state('s.items.arrows[0].x'),old_x+15)
        self.page.locator('[data-layer="numbering"]').click()
        self.click_at(350,180)
        self.page.locator('[data-layer="arrows"]').click()
        self.page.locator('#undoBtn').click()
        self.assertAlmostEqual(self.state('s.items.arrows[0].x'), old_x, delta=5)
        self.assertEqual(self.state('s.items.numbering.length'),1)
        self.page.locator('#redoBtn').click()
        self.assertGreater(self.state('s.items.arrows[0].x'),old_x+15)

    def test_roi_visibility_and_png_original_size(self):
        """Validate ROI availability and cropped PNG dimensions.

        Hiding the ROI must revoke crop controls while export uses intrinsic source pixels.
        """
        self.upload()
        self.assertTrue(self.page.locator('#viewCrop').is_disabled())
        self.assertFalse(self.page.locator('#exportCropOption').is_visible())
        self.page.locator('[data-layer="roi"]').click()
        self.drag_at(55,65,245,205)
        self.assertTrue(self.state('!!s.items.roi && s.items.roi.w>0'))
        self.assertFalse(self.page.locator('#viewCrop').is_disabled())
        self.assertTrue(self.page.locator('#exportCropOption').is_visible())
        self.page.locator('#exportCrop').check()
        with self.page.expect_download() as item:
            self.page.locator('#downloadFlattenedImageBtn').click()
        dl=item.value
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/dl.suggested_filename
            dl.save_as(path)
            raw=path.read_bytes()
            self.assertEqual(raw[:8],b'\x89PNG\r\n\x1a\n')
            w,h=struct.unpack('>II',raw[16:24])
            self.assertGreater(w,1); self.assertLess(w,640)
            self.assertGreater(h,1); self.assertLess(h,400)
        self.page.locator('[data-eye="roi"]').click()
        self.assertTrue(self.page.locator('#viewCrop').is_disabled())
        self.assertFalse(self.page.locator('#exportCropOption').is_visible())

    # ========================================================================
    # 03. Project ZIP, import safety and image-limit tests
    # ========================================================================
    def test_project_zip_roundtrip_history_and_corrupt_archive(self):
        """Round-trip visible state, layer order and undo/redo in ZIP.

        A deliberately damaged source image payload must fail CRC verification without losing the open project.
        """
        self.upload()
        self.click_at(120,130)
        self.page.keyboard.press('Control+z')
        self.assertEqual(self.state('s.hist.arrows.redo.length'),1)
        self.page.locator('#swapLayers').click()
        self.page.locator('[data-eye="numbering"]').click()
        with self.page.expect_download() as item:
            self.page.locator('#downloadProjectBtn').click()
        dl=item.value
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'saved.zip'
            dl.save_as(path)
            archive=path.read_bytes()
            self.assertFalse(self.state('s.dirty'))
            self.page.once('dialog',lambda d: d.accept())
            self.page.locator('#newProjectButton').click()
            self.assertFalse(self.state('s.loaded'))
            self.page.locator('#fileInput').set_input_files({'name':'saved.zip','mimeType':'application/zip','buffer':archive})
            self.page.wait_for_function('window.__studioTest.state.loaded')
            self.assertEqual(self.state('s.front'),['numbering','arrows'])
            self.assertFalse(self.state('s.visible.numbering'))
            self.assertEqual(self.state('s.hist.arrows.redo.length'),1)
            self.assertFalse(self.state('s.dirty'))
            self.page.locator('[data-layer="arrows"]').click()
            self.page.locator('#redoBtn').click()
            self.assertEqual(self.state('s.items.arrows.length'),1)
            self.assertTrue(self.state('s.dirty'))
            # Break the image entry CRC; the currently open project must remain intact.
            broken=bytearray(archive)
            marker=broken.find(b'\x89PNG\r\n\x1a\n')
            self.assertGreater(marker,0)
            broken[marker+40] ^= 0x5f
            current=self.state('JSON.stringify(s.items)')
            self.page.locator('#fileInput').set_input_files({'name':'broken.zip','mimeType':'application/zip','buffer':bytes(broken)})
            self.page.wait_for_timeout(350)
            self.assertEqual(self.state('JSON.stringify(s.items)'),current)
            self.assertTrue(self.state('s.loaded'))

    def test_global_settings_local_settings_and_responsive_layout(self):
        """Exercise palette, tool settings and responsive layout.

        Checks saved settings and UI behavior across viewport sizes.
        """
        self.upload()
        self.page.locator('#settingsButton').click()
        self.page.locator('#cfg_standardStroke').fill('#223355')
        self.page.locator('#settingsTabs button').nth(2).click()  # Numbering tab
        self.page.locator('#cfg_radius').fill('27')
        self.page.locator('#settingsSaveButton').click()
        self.assertEqual(self.state('s.palette.standardStroke'),'#223355')
        self.assertEqual(self.state('s.settings.numbering.radius'),27)
        self.assertEqual(self.state('s.settings.arrows.width'),100)
        # Preserve the compact layout across the widths covered during UI design.
        for width in (390,800,1280):
            self.page.set_viewport_size({'width':width,'height':900})
            self.page.wait_for_timeout(75)
            self.assertTrue(self.page.locator('#layerCards').is_visible())
            self.assertTrue(self.page.locator('#downloadFlattenedImageBtn').is_visible())
            for card in self.page.locator('.tool-card').all():
                self.assertLessEqual(card.bounding_box()['width'], width)

    def test_limits_and_active_mode_keyboard(self):
        """Verify tool limits and editing-mode keyboard shortcuts.

        Checks active-tool behaviors and safeguards for invalid operations.
        """
        self.upload()
        self.assertEqual(self.page.locator('#standardBtn').get_attribute('aria-pressed'),'true')
        self.page.keyboard.down('Control')
        self.assertEqual(self.page.locator('#invertedBtn').get_attribute('aria-pressed'),'true')
        self.page.keyboard.up('Control')
        self.assertEqual(self.page.locator('#standardBtn').get_attribute('aria-pressed'),'true')
        self.assertTrue(self.page.evaluate('() => { try { window.__studioTest.checkImageSize(16385,1,100); return false } catch { return true } }'))
        # Existing project must survive an invalid/oversized image upload.
        self.click_at(130,130)
        old=self.state('s.items.arrows.length')
        self.page.locator('#fileInput').set_input_files({'name':'oversize.png','mimeType':'image/png','buffer':make_png(16385,1)})
        self.page.wait_for_timeout(350)
        self.assertEqual(self.state('s.items.arrows.length'),old)

    def test_keyboard_layer_switch_and_language_menu_accessibility(self):
        """Verify keyboard-only editing and language navigation.

        Uses layer shortcuts and language menu focus/selection semantics.
        """
        self.upload()
        card=self.page.locator('[data-layer="numbering"]')
        card.focus()
        self.page.keyboard.press('Enter')
        self.assertEqual(self.state('s.active'),'numbering')
        self.assertEqual(card.get_attribute('aria-pressed'),'true')
        self.page.locator('#languageToggle').focus()
        self.page.keyboard.press('ArrowDown')
        self.assertEqual(self.page.locator('#languageToggle').get_attribute('aria-expanded'),'true')
        self.page.keyboard.press('ArrowDown')
        self.assertEqual(self.page.evaluate('document.activeElement.dataset.language'),'de')
        self.page.keyboard.press('ArrowUp')
        self.assertEqual(self.page.evaluate('document.activeElement.dataset.language'),'en')
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('#languageToggle').get_attribute('aria-expanded'),'false')
        self.assertTrue(self.page.locator('#languageToggle').evaluate('(e)=>e===document.activeElement'))

    def test_visibility_swap_and_reset_respect_layer_boundaries(self):
        """Check layer order, visibility and reset independence.

        A change to one tool or visibility control must not mutate a different tool's annotations.
        """
        self.upload()
        self.click_at(140,140)
        self.page.locator('[data-layer="numbering"]').click()
        self.click_at(260,160)
        self.assertEqual(self.state('s.items.arrows.length'),1)
        self.assertEqual(self.state('s.items.numbering.length'),1)
        self.page.locator('#swapLayers').click()
        self.assertEqual(self.state('s.front'),['numbering','arrows'])
        self.page.locator('[data-eye="numbering"]').click()
        self.assertFalse(self.state('s.visible.numbering'))
        self.assertEqual(self.state('s.items.numbering.length'),1)
        self.page.locator('[data-reset="numbering"]').click()
        self.assertEqual(self.state('s.items.numbering.length'),0)
        self.assertEqual(self.state('s.items.arrows.length'),1)
        self.page.locator('[data-layer="numbering"]').click()
        self.page.locator('#undoBtn').click()
        self.assertEqual(self.state('s.items.numbering.length'),1)

    def test_invalid_project_import_preserves_settings_and_histories(self):
        """Reject malformed imported state while preserving the editor.

        Invalid manifests may not overwrite palette, tool histories or annotations.
        """
        self.upload()
        self.click_at(120,130)
        self.page.keyboard.press('Control+z')
        baseline=self.state('JSON.stringify({items:s.items,hist:s.hist,front:s.front,settings:s.settings,palette:s.palette})')
        self.page.locator('#fileInput').set_input_files({'name':'invalid.zip','mimeType':'application/zip','buffer':b'not a zip'})
        self.page.wait_for_timeout(300)
        self.assertTrue(self.state('s.loaded'))
        self.assertEqual(self.state('JSON.stringify({items:s.items,hist:s.hist,front:s.front,settings:s.settings,palette:s.palette})'),baseline)
        self.assertEqual(self.state('s.hist.arrows.redo.length'),1)

    def test_image_size_edge_cases_and_reload_warning(self):
        """Reject oversized images and protect unsaved edits.

        Covers boundary conditions and beforeunload behavior after editing.
        """
        self.upload()
        self.assertTrue(self.page.evaluate('() => { try {window.__studioTest.checkImageSize(1,1,1);return true;}catch{return false;} }'))
        for dims in [(0,100,50), (100,0,50), (16385,1,50), (100,100,70*1024*1024), (100000,100000,100)]:
            self.assertTrue(self.page.evaluate('d => {try {window.__studioTest.checkImageSize(...d);return false;}catch{return true;}}',dims))
        self.assertTrue(self.state('s.dirty'))  # An uploaded, unsaved image is protected.
        self.click_at(100,100)
        self.assertTrue(self.state('s.dirty'))
        self.assertTrue(self.page.evaluate('() => {const ev=new Event("beforeunload",{cancelable:true});window.dispatchEvent(ev);return ev.defaultPrevented;}'))
        self.page.keyboard.press('Control+z')
        self.assertTrue(self.state('s.dirty'))

    # ========================================================================
    # 04. JPEG compression, crop, quality and transparency tests
    # ========================================================================
    def test_jpg_and_png_buttons_export_original_dimensions(self):
        """Download PNG and JPEG from the same source image.

        Verify actual file signatures, names and intrinsic dimensions, including browser JPEG decoding.
        """
        self.upload()
        self.assertTrue(self.page.locator('#downloadFlattenedImageBtn').is_visible())
        self.assertTrue(self.page.locator('#downloadJpgBtn').is_visible())
        self.page.locator('#timestampCheckbox').uncheck()
        with self.page.expect_download() as png_event:
            self.page.locator('#downloadFlattenedImageBtn').click()
        with self.page.expect_download() as jpg_event:
            self.page.locator('#downloadJpgBtn').click()
        with tempfile.TemporaryDirectory() as temp:
            png_path=Path(temp)/png_event.value.suggested_filename
            jpg_path=Path(temp)/jpg_event.value.suggested_filename
            png_event.value.save_as(png_path)
            jpg_event.value.save_as(jpg_path)
            png_data=png_path.read_bytes()
            jpg_data=jpg_path.read_bytes()
        self.assertTrue(png_path.name.endswith('_annotated.png'))
        self.assertTrue(jpg_path.name.endswith('_annotated.jpg'))
        self.assertEqual(png_data[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(jpg_data[:3], b'\xff\xd8\xff')
        self.assertEqual(struct.unpack('>II', png_data[16:24]),(640,400))
        # Use the browser's JPEG decoder; confirms a valid image at native resolution.
        jpg_base64=base64.b64encode(jpg_data).decode('ascii')
        self.assertEqual(self.page.evaluate("""async data => {
            const image=new Image();image.src='data:image/jpeg;base64,'+data;
            await image.decode();return [image.naturalWidth,image.naturalHeight];
        }""",jpg_base64),[640,400])

    def test_jpeg_compression_settings_and_roi_export(self):
        """Exercise all JPEG compression settings and ROI-only JPEG.

        Intercepts canvas.toBlob to confirm quality hints, then decodes the cropped JPEG and tests reset.
        """
        self.upload()
        self.assertEqual(self.state('s.jpegCompression'),'medium')
        self.page.locator('#settingsButton').click()
        self.assertEqual(self.page.locator('#cfg_jpegCompression').input_value(),'medium')
        self.assertEqual(self.page.locator('#cfg_jpegCompression option').count(),3)
        self.page.locator('#cfg_jpegCompression').select_option('low')
        self.page.locator('#settingsSaveButton').click()
        self.assertEqual(self.state('s.jpegCompression'),'low')
        # Capture the exact quality hint sent to the native JPEG encoder.
        self.page.evaluate("""() => {
          window.__jpegCalls=[];
          const original=HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob=function(callback,mime,quality){
             window.__jpegCalls.push({mime,quality});return original.call(this,callback,mime,quality);
          };
        }""")
        with self.page.expect_download():
            self.page.locator('#downloadJpgBtn').click()
        self.assertEqual(self.page.evaluate('window.__jpegCalls.at(-1)'),{'mime':'image/jpeg','quality':0.92})
        self.page.locator('#settingsButton').click()
        self.page.locator('#cfg_jpegCompression').select_option('high')
        self.page.locator('#settingsSaveButton').click()
        self.page.locator('[data-layer="roi"]').click()
        self.drag_at(80,60,230,180)
        self.assertTrue(self.page.locator('#exportCrop').is_enabled())
        self.page.locator('#exportCrop').check()
        with self.page.expect_download() as item:
            self.page.locator('#downloadJpgBtn').click()
        self.assertTrue(item.value.suggested_filename.endswith('_roi_annotated.jpg') is False)  # only one scope suffix
        self.assertIn('_roi',item.value.suggested_filename)
        self.assertEqual(self.page.evaluate('window.__jpegCalls.at(-1)'),{'mime':'image/jpeg','quality':0.6})
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/item.value.suggested_filename
            item.value.save_as(path)
            data=base64.b64encode(path.read_bytes()).decode('ascii')
        dims=self.page.evaluate("""async data => {
            const image=new Image();image.src='data:image/jpeg;base64,'+data;
            await image.decode();return [image.naturalWidth,image.naturalHeight];
        }""",data)
        self.assertTrue(1<dims[0]<640 and 1<dims[1]<400)
        self.page.locator('#settingsButton').click()
        self.page.locator('#settingsResetButton').click()
        self.assertEqual(self.page.locator('#cfg_jpegCompression').input_value(),'medium')
        self.page.locator('#settingsSaveButton').click()
        self.assertEqual(self.state('s.jpegCompression'),'medium')

    def test_jpeg_compression_project_roundtrip_legacy_and_invalid(self):
        """Persist JPEG quality in ZIP and handle backward compatibility.

        High quality round-trips; older ZIPs default to Medium; malformed settings are rejected.
        """
        self.upload()
        self.page.locator('#settingsButton').click()
        self.page.locator('#cfg_jpegCompression').select_option('high')
        self.page.locator('#settingsSaveButton').click()
        with self.page.expect_download() as item:
            self.page.locator('#downloadProjectBtn').click()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'original.zip';item.value.save_as(path)
            raw=path.read_bytes()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            doc=json.loads(z.read('project.json'))
            image_name=doc['image']['entry'];image_bytes=z.read(image_name)
        self.assertEqual(doc['state']['export']['jpegCompression'],'high')
        self.page.once('dialog',lambda d:d.accept())
        self.page.locator('#newProjectButton').click()
        self.page.locator('#fileInput').set_input_files({'name':'saved.zip','mimeType':'application/zip','buffer':raw})
        self.page.wait_for_function('window.__studioTest.state.loaded')
        self.assertEqual(self.state('s.jpegCompression'),'high')
        self.page.locator('#settingsButton').click()
        self.assertEqual(self.page.locator('#cfg_jpegCompression').input_value(),'high')
        self.page.locator('#settingsCancelButton').click()
        # Older version-1 ZIPs omit this optional setting; they must default to Medium.
        old=json.loads(json.dumps(doc));del old['state']['export']['jpegCompression']
        def repack(payload):
            """Rebuild an uncompressed project ZIP around the supplied manifest.

            Keeps the original image bytes so tests can isolate manifest validation.
            """
            stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_STORED) as z:
                z.writestr('project.json',json.dumps(payload))
                z.writestr(image_name,image_bytes)
            return stream.getvalue()
        self.page.locator('#fileInput').set_input_files({'name':'old.zip','mimeType':'application/zip','buffer':repack(old)})
        self.page.wait_for_function("window.__studioTest.state.jpegCompression === 'medium'")
        # An unknown value must fail *without* replacing the open project.
        invalid=json.loads(json.dumps(doc));invalid['state']['export']['jpegCompression']='extreme'
        self.page.locator('#fileInput').set_input_files({'name':'invalid.zip','mimeType':'application/zip','buffer':repack(invalid)})
        self.page.wait_for_timeout(300)
        self.assertTrue(self.state('s.loaded'))
        self.assertEqual(self.state('s.jpegCompression'),'medium')

    def test_jpg_transparent_pixels_are_white(self):
        """Ensure transparent PNG pixels become white in JPEG.

        Decodes the emitted JPEG and samples a transparent area, allowing small lossy-color tolerances.
        """
        self.upload()
        # Reuse synthetic browser-generated transparent image (white comp under JPEG).
        rgba=self.page.evaluate("""() => {
            const c=document.createElement('canvas');c.width=32;c.height=24;
            const ctx=c.getContext('2d');ctx.clearRect(0,0,32,24);
            return c.toDataURL('image/png').split(',')[1];
        }""")
        self.page.locator('#fileInput').set_input_files({'name':'transparent.png','mimeType':'image/png','buffer':base64.b64decode(rgba)})
        self.page.wait_for_function('window.__studioTest.state.img.naturalWidth === 32')
        with self.page.expect_download() as item:
            self.page.locator('#downloadJpgBtn').click()
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'image.jpg';item.value.save_as(path)
            data=base64.b64encode(path.read_bytes()).decode('ascii')
        rgb=self.page.evaluate("""async data => {
            const image=new Image();image.src='data:image/jpeg;base64,'+data;
            await image.decode();const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
            const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
            return [...ctx.getImageData(15,12,1,1).data];
        }""",data)
        self.assertTrue(all(x>=246 for x in rgb[:3]),rgb)

    # ========================================================================
    # 05. Startup language and project language persistence
    # ========================================================================
    def test_saved_german_project_restores_language_after_english_startup(self):
        """Ensure a German project ZIP overrides the English startup default.

        Saves a project in German, starts a new isolated English browser document,
        and imports the ZIP to restore German as recorded in its manifest.
        """
        self.assertEqual(self.state('s.lang'),'en')
        self.upload()
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="de"]').click()
        self.assertEqual(self.state('s.lang'),'de')
        with self.page.expect_download() as item:
            self.page.locator('#downloadProjectBtn').click()
        with tempfile.TemporaryDirectory() as directory:
            saved=Path(directory)/'german_project.zip'
            item.value.save_as(saved)
            payload=saved.read_bytes()
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest=json.loads(archive.read('project.json'))
        self.assertEqual(manifest['state']['lang'],'de')
        # Navigate to a genuinely fresh document; a new project preserves an
        # existing manual language choice and therefore is not an equivalent reset.
        self.page.goto('about:blank')
        self.page.set_content(ENTRY.read_text(encoding='utf8'), wait_until='load')
        self.assertEqual(self.state('s.lang'),'en')
        self.page.locator('#fileInput').set_input_files({
            'name':'german_project.zip', 'mimeType':'application/zip', 'buffer':payload
        })
        self.page.wait_for_function('window.__studioTest.state.loaded')
        self.assertEqual(self.state('s.lang'),'de')
        self.assertEqual(self.page.locator('html').get_attribute('lang'),'de')
        self.assertEqual(self.page.locator('#languageToggle').inner_text().strip(),'DE')


    # ========================================================================
    # 06. GitHub repository footer link and bilingual label
    # ========================================================================
    def test_github_footer_link_is_bilingual_and_requires_no_network(self):
        """Verify the branded link is beneath the footer in English and German.

        The link is never clicked: the application remains offline until the
        user intentionally navigates to the external GitHub repository.
        """
        link = self.page.locator('#githubProjectLink')
        self.assertTrue(link.is_visible())
        self.assertEqual(link.get_attribute('href'), 'https://github.com/Sperker/ImageAnnotationStudio')
        self.assertEqual(link.get_attribute('target'), '_blank')
        self.assertEqual(link.get_attribute('rel'), 'noopener noreferrer')
        self.assertEqual(link.locator('svg').count(), 1)
        self.assertEqual(link.inner_text().strip(), 'Download this project on GitHub')
        footer_box = self.page.locator('#bottom > span').bounding_box()
        link_box = link.bounding_box()
        self.assertGreaterEqual(link_box['y'], footer_box['y'] + footer_box['height'])
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="de"]').click()
        self.assertEqual(link.inner_text().strip(), 'Dieses Projekt auf GitHub herunterladen')
        self.page.set_viewport_size({'width': 360, 'height': 740})
        link_box = link.bounding_box()
        self.assertGreaterEqual(link_box['x'], 0)
        self.assertLessEqual(link_box['x'] + link_box['width'], 360)

    # ========================================================================
    # 07. Narrow-screen layer card reflow and footer styling
    # ========================================================================
    def test_narrow_layer_navigation_keeps_cards_usable_and_roi_full_width(self):
        """Reflow drawing cards and ROI at 740px without clipping.

        Drawings remain on row one, independent ROI fills row two, and the
        desktop separator disappears. Desktop navigation remains unchanged.
        """
        self.upload()
        for width in (320, 360, 390, 500, 640, 728, 740, 741, 800, 1280):
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 800})
                data = self.page.evaluate('''
                    () => {
                        const rect = id => {
                            const b = document.getElementById(id).getBoundingClientRect();
                            return {x: b.left, y: b.top, right: b.right,
                                    bottom: b.bottom, width: b.width};
                        };
                        const cards = [...document.querySelectorAll('#layerCards .tool-card')].map(el => {
                            const b = el.getBoundingClientRect();
                            return {x: b.left, y: b.top, right: b.right,
                                    bottom: b.bottom, width: b.width};
                        });
                        return {layer: rect('layerBar'), drawing: rect('drawingGroup'),
                                roi: rect('roiCardSlot'), separator: getComputedStyle(
                                    document.getElementById('roiSeparator')).display,
                                scrollWidth: document.documentElement.scrollWidth,
                                cards};
                    }
                ''')
                self.assertEqual(len(data['cards']), 3)
                self.assertLessEqual(data['scrollWidth'], width + 1)
                for card in data['cards']:
                    self.assertGreaterEqual(card['x'], data['layer']['x'] - 1)
                    self.assertLessEqual(card['right'], data['layer']['right'] + 1)
                if width <= 740:
                    self.assertEqual(data['separator'], 'none')
                    self.assertGreaterEqual(data['roi']['y'], data['drawing']['bottom'] + 1)
                    self.assertAlmostEqual(data['roi']['width'], data['layer']['width'], delta=1)
                    self.assertAlmostEqual(data['cards'][2]['width'], data['layer']['width'], delta=1)
                    self.assertAlmostEqual(data['cards'][0]['y'], data['cards'][1]['y'], delta=1)
                else:
                    self.assertNotEqual(data['separator'], 'none')
                    self.assertAlmostEqual(data['drawing']['y'], data['roi']['y'], delta=1)

        self.page.set_viewport_size({'width': 500, 'height': 800})
        self.page.locator('#roiCardSlot [data-layer="roi"]').click()
        self.assertEqual(self.state('s.active'), 'roi')
        self.page.locator('#drawingGroup [data-layer="numbering"]').click()
        self.assertEqual(self.state('s.active'), 'numbering')
        before = self.state('s.front.slice()')
        self.page.locator('#swapLayers').click()
        self.assertEqual(self.state('s.front.slice()'), list(reversed(before)))

    def test_github_footer_uses_requested_subtle_typography(self):
        """Check the custom GitHub link styles in the compiled browser page."""
        computed = self.page.locator('#githubProjectLink').evaluate('''
            el => {
                const s = getComputedStyle(el);
                return {color: s.color, weight: s.fontWeight, fontSize: s.fontSize,
                        display: s.display, gap: s.gap, marginTop: s.marginTop,
                        padding: s.padding, alignItems: s.alignItems,
                        justifyContent: s.justifyContent};
            }
        ''')
        self.assertEqual(computed, {
            'color': 'rgb(187, 187, 187)', 'weight': '400', 'fontSize': '12px',
            'display': 'inline-flex', 'gap': '7px', 'marginTop': '9px',
            'padding': '4px 6px', 'alignItems': 'center',
            'justifyContent': 'center',
        })


if __name__ == '__main__':
    unittest.main(verbosity=2)
