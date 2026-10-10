"""Fast offline browser smoke checks (requires Playwright)."""
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "e2e"))
from test_studio import ENTRY, make_png, ENGINE

class Smoke(unittest.TestCase):
    def test_start_upload_switch_and_export_controls(self):
        with sync_playwright() as p:
            browser_type = getattr(p, ENGINE)
            if ENGINE == 'chromium' and Path('/usr/bin/chromium').exists() and not Path(browser_type.executable_path).exists():
                browser = browser_type.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
            else:
                browser = browser_type.launch(headless=True)
            try:
                page = browser.new_page()
                errors, requests = [], []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('request', lambda r: requests.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
                page.set_content(ENTRY.read_text(encoding='utf8'), wait_until='load')
                self.assertTrue(page.locator('#cont_drop_zone').is_visible())
                page.locator('#fileInput').set_input_files({'name':'smoke.png','mimeType':'image/png','buffer':make_png(32,32)})
                page.wait_for_function('window.__studioTest.state.loaded')
                for layer in ('arrows','numbering','roi'):
                    page.locator(f'[data-layer="{layer}"]').click()
                    self.assertEqual(page.evaluate('window.__studioTest.state.active'), layer)
                self.assertTrue(page.locator('#downloadFlattenedImageBtn').is_visible())
                self.assertTrue(page.locator('#downloadJpgBtn').is_visible())
                self.assertEqual(errors, [])
                self.assertEqual(requests, [])
            finally:
                browser.close()
