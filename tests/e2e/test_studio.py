"""Full-product offline browser regression. Run: npm run test:e2e."""
import io
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


def make_png(width=640, height=400):
    """Small synthetic PNG with no imaging-library dependency."""
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xffffffff)
    raw = b''.join(b'\x00' + (b'\xee\xee\xee' * width) for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


class StudioRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.play = sync_playwright().start()
        browser_type = getattr(cls.play, ENGINE)
        if ENGINE == 'chromium' and Path('/usr/bin/chromium').exists() and not Path(browser_type.executable_path).exists():
            cls.browser = browser_type.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        else:
            cls.browser = browser_type.launch(headless=True)
        assert ENTRY.is_file(), f'Run npm run build first: {ENTRY}'

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.play.stop()

    def setUp(self):
        self.context = self.browser.new_context(accept_downloads=True, viewport={'width': 1280, 'height': 900})
        self.page = self.context.new_page()
        self.errors = []
        self.external_requests = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('request', lambda r: self.external_requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
        # Render the exact built HTML in memory: works even in restricted CI browsers blocking file://.
        self.page.set_content(ENTRY.read_text(encoding='utf8'), wait_until='load')

    def tearDown(self):
        self.assertEqual(self.errors, [], 'Unexpected JS errors')
        self.assertEqual(self.external_requests, [], 'Offline build made external requests')
        self.context.close()

    def state(self, expr):
        return self.page.evaluate(f'() => {{ const s = window.__studioTest.state; return ({expr}); }}')

    def upload(self):
        self.page.locator('#fileInput').set_input_files({'name': 'sample.png', 'mimeType': 'image/png', 'buffer': make_png()})
        self.page.wait_for_function('window.__studioTest.state.loaded')
        self.assertEqual(self.state('s.img.naturalWidth'), 640)

    def click_at(self, x, y):
        box=self.page.locator('#canvas').bounding_box()
        self.page.mouse.click(box['x']+x,box['y']+y)

    def drag_at(self, x1,y1,x2,y2):
        box=self.page.locator('#canvas').bounding_box()
        self.page.mouse.move(box['x']+x1,box['y']+y1)
        self.page.mouse.down()
        self.page.mouse.move(box['x']+x2,box['y']+y2,steps=6)
        self.page.mouse.up()

    def test_initial_state_and_language(self):
        self.assertTrue(self.page.locator('#cont_drop_zone').is_visible())
        self.assertEqual(self.page.locator('#layerContainer').evaluate('(el)=>getComputedStyle(el).display'), 'none')
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="en"]').click()
        self.assertEqual(self.state('s.lang'), 'en')
        self.assertIn('Zero-Friction', self.page.locator('#topSubtitle').inner_text())
        self.page.locator('#languageToggle').click()
        self.page.locator('#languageMenu [data-language="de"]').click()
        self.assertEqual(self.state('s.lang'), 'de')

    def test_numbering_delete_renumber_and_history(self):
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

    def test_project_zip_roundtrip_history_and_corrupt_archive(self):
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
        self.assertEqual(self.page.evaluate('document.activeElement.dataset.language'),'en')
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('#languageToggle').get_attribute('aria-expanded'),'false')
        self.assertTrue(self.page.locator('#languageToggle').evaluate('(e)=>e===document.activeElement'))

    def test_visibility_swap_and_reset_respect_layer_boundaries(self):
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

if __name__ == '__main__':
    unittest.main(verbosity=2)
