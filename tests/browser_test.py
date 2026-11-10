# UI test: every example, dragging the psychrometric state, scrubbing, hover readouts, math drawer,
# light/dark/iPad/phone, a download. Run: ~/.venvs/mcmaster_torx/bin/python tests/browser_test.py <out_dir>
import os, sys
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__)); out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/thermo_shots'
os.makedirs(out, exist_ok=True)
url = 'file://' + os.path.join(here, '..', 'docs', 'index.html')
errs = []
KEYS = ['otto', 'diesel', 'dual', 'braytonIdeal', 'braytonReal', 'stirling', 'carnot', 'comfort', 'coolingCoil', 'winterHeat', 'swamp', 'mixing', 'highAlt',
        'oilCooler', 'oilCoolerParallel', 'shellTube', 'radiator', 'heaterBlock', 'hotPlate', 'blockAndLoad', 'constantPower', 'coolDown']
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True)
    def page(w, h, scheme, touch=False):
        ctx = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, device_scale_factor=2, has_touch=touch, accept_downloads=True)
        pg = ctx.new_page()
        pg.on('console', lambda m: m.type in ('error', 'warning') and errs.append(f'{scheme} {w}: {m.text}'))
        pg.on('pageerror', lambda e: errs.append(f'{scheme} {w}: pageerror {e}'))
        pg.goto(url); pg.wait_for_timeout(700)
        return pg
    pg = page(1440, 900, 'light')
    print('start |', pg.inner_text('#status'))
    for k in KEYS:
        pg.select_option('#presetSel', k); pg.wait_for_timeout(500)
        if pg.is_visible('#playBtn') and pg.get_attribute('#playBtn', 'aria-label') == 'Pause': pg.click('#playBtn')
        pg.evaluate("() => { const s = document.querySelector('#state'); s.value = 620; s.dispatchEvent(new Event('input')); }"); pg.wait_for_timeout(120)
        print(k, '|', pg.inner_text('#status'), '|', pg.inner_text('#stateOut')[:90])
        pg.screenshot(path=f'{out}/p_{k}.png')
    # drag state 1 on the psychrometric chart
    pg.select_option('#presetSel', 'comfort'); pg.wait_for_timeout(400)
    box = pg.locator('#cv').bounding_box(); sx, sy = pg.evaluate('window.__thermoBench.state1Screen()')
    pg.mouse.move(box['x'] + sx, box['y'] + sy); pg.mouse.down(); pg.mouse.move(box['x'] + sx + 90, box['y'] + sy - 40, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
    m = pg.evaluate('window.__thermoBench.model.psychro'); print('dragged | t =', m['t'], 'val =', m['val'], '|', pg.inner_text('#status'))
    pg.mouse.move(box['x'] + box['width'] * 0.6, box['y'] + box['height'] * 0.8); pg.wait_for_timeout(150); print('hover psy |', pg.inner_text('#stateOut'))
    pg.keyboard.press('Meta+z'); pg.wait_for_timeout(200); print('undo | t =', pg.evaluate('window.__thermoBench.model.psychro.t'))
    # hover a chart in the cycles lab, edit a field, switch a mode
    pg.select_option('#presetSel', 'otto'); pg.wait_for_timeout(300); pg.click('#playBtn')
    c = pg.evaluate('window.__thermoBench.charts()')[0]; pg.mouse.move(box['x'] + c['px'] + c['pw'] * 0.3, box['y'] + c['py'] + c['ph'] * 0.5); pg.wait_for_timeout(150); print('hover pv |', pg.inner_text('#stateOut'))
    pg.fill('#f-r', '11'); pg.press('#f-r', 'Enter'); pg.wait_for_timeout(300); print('r = 11 |', pg.inner_text('#status'))
    pg.fill('#f-Tmax', '200'); pg.press('#f-Tmax', 'Enter'); pg.wait_for_timeout(300); print('too cold |', pg.inner_text('#status')); pg.screenshot(path=f'{out}/error.png')
    pg.keyboard.press('Escape'); pg.click('#undoBtn'); pg.wait_for_timeout(200)
    pg.select_option('#s-type', 'brayton'); pg.wait_for_timeout(300); print('switch to brayton |', pg.inner_text('#status'))
    pg.select_option('#presetSel', 'shellTube'); pg.wait_for_timeout(300); pg.click('.seg button[data-v=rating]'); pg.wait_for_timeout(300); print('sizing → rating |', pg.inner_text('#status'), '| A =', pg.input_value('#f-A'))
    pg.select_option('#presetSel', 'comfort'); pg.wait_for_timeout(300); pg.select_option('#s-mode', 'twb'); pg.wait_for_timeout(300); print('mode wet bulb | val =', pg.input_value('#f-val'), '|', pg.inner_text('#status'))
    for k in ['otto', 'coolingCoil', 'oilCooler', 'blockAndLoad']:
        pg.select_option('#presetSel', k); pg.wait_for_timeout(300); pg.click('#mathBtn'); pg.wait_for_timeout(350); pg.screenshot(path=f'{out}/math_{k}.png')
        print('math', k, '|', pg.eval_on_selector_all('#mathBody summary', 'ss => ss.map(s => s.textContent).join(", ")')); pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
    for act in ['csv', 'save', 'png']:
        with pg.expect_download() as d:
            pg.click('#fileBtn'); pg.click(f'[data-act={act}]')
        print('download:', d.value.suggested_filename)
    pgd = page(1440, 900, 'dark')
    for k in ['braytonReal', 'coolingCoil', 'shellTube', 'blockAndLoad']:
        pgd.select_option('#presetSel', k); pgd.wait_for_timeout(1500 if k == 'blockAndLoad' else 500); pgd.screenshot(path=f'{out}/dark_{k}.png')
    pgi = page(1180, 820, 'light', True)
    for k in ['otto', 'mixing']:
        pgi.select_option('#presetSel', k); pgi.wait_for_timeout(500); pgi.screenshot(path=f'{out}/ipad_{k}.png', full_page=True)
    print('ipad scrollWidth', pgi.evaluate('document.documentElement.scrollWidth'))
    pgm = page(390, 844, 'light', True)
    for k in ['otto', 'coolingCoil', 'oilCooler', 'heaterBlock']:
        pgm.select_option('#presetSel', k); pgm.wait_for_timeout(500); pgm.screenshot(path=f'{out}/phone_{k}.png', full_page=True)
    print('phone scrollWidth', pgm.evaluate('document.documentElement.scrollWidth'))
    b.close()
print('\n'.join(errs) or 'no console errors')
