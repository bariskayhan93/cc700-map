// Browser layout regression: the full display and every overlay must share one scale.
// Run with CC700_BROWSER=/path/to/chrome-headless-shell node tools/test_preview_layout.mjs.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const browser = process.env.CC700_BROWSER;
assert(browser, 'Set CC700_BROWSER to a Chromium-compatible headless browser executable');
const temporary = mkdtempSync(join(tmpdir(), 'cc700-layout-'));
const checks = () => {
  const results = [];
  const screen = document.querySelector('.device-screen');
  document.getElementById('out').hidden = false;
  document.getElementById('turnDistance').textContent = '666';
  document.getElementById('turnUnit').textContent = 'm';
  document.getElementById('rideSpeed').textContent = '16.1';
  const bounds = selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x:r.x, y:r.y, width:r.width, height:r.height };
  };
  // A narrow phone, native size, and desktop maximum. Change available width
  // rather than transform the fixture, so container units must actually respond.
  for (const available of [180, 252, 360]) {
    screen.style.width = `${available}px`;
    for (const caption of ['Go straight', 'A deliberately long outgoing street caption', 'then left · A deliberately long outgoing street caption']) {
      document.getElementById('turnCaption').textContent = caption;
      results.push({ captionText:caption, captionScrollWidth:document.getElementById('turnCaption').scrollWidth, captionClientWidth:document.getElementById('turnCaption').clientWidth, screen:bounds('.device-screen'), map:bounds('#cv'),
        caption:bounds('#turnCaption'),
        captionOverflow:getComputedStyle(document.getElementById('turnCaption')).overflowX,
        rows:document.querySelector('.turn-copy').children.length,
        unsupportedRows:!!document.querySelector('#turnInstruction, #turnStreet, #turnNext'),
        card:bounds('.turn-card'), arrow:bounds('.turn-arrow'),
        track:bounds('.ride-track'), metrics:bounds('.ride-metrics'),
        distanceFont:parseFloat(getComputedStyle(document.querySelector('.turn-distance')).fontSize),
        metricFont:parseFloat(getComputedStyle(document.querySelector('.ride-metrics dd')).fontSize),
        canvas:[document.getElementById('cv').width, document.getElementById('cv').height] });
    }
  }
  document.body.textContent = 'LAYOUT_RESULT:' + JSON.stringify(results);
};
try {
  const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const fixture = join(temporary, 'layout.html');
  writeFileSync(fixture, source.replace('</body>', `<script>(${checks})()</script></body>`));
  const output = execFileSync(browser, ['--headless', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-background-networking', '--disable-extensions',
    `--user-data-dir=${join(temporary, 'profile')}`, '--dump-dom', pathToFileURL(fixture).href],
    { encoding:'utf8', timeout:30000, stdio:['ignore','pipe','pipe'] });
  const match = output.match(/LAYOUT_RESULT:(\[[^<]+\])/);
  assert(match, 'Browser returned no layout measurements');
  const rows = JSON.parse(match[1]);
  const near = (actual, expected, description) => assert(Math.abs(actual - expected) < 0.15,
    `${description}: expected ${expected}, got ${actual}`);
  for (const row of rows) {
    const nativeScale = row.map.width / 240;
    const height = row.map.height + row.track.height + row.metrics.height;
    near(row.map.height, 256 * nativeScale, 'map preserves 240:256 without distortion');
    near(height, 320 * nativeScale, 'complete display preserves 240:320');
    near(row.track.y, row.map.y + row.map.height, 'progress directly follows map');
    near(row.metrics.y, row.track.y + row.track.height, 'metrics directly follow progress');
    near(row.screen.height - 12, height, 'bezel contains exactly the full display');
    assert.deepEqual(row.canvas, [240, 256], 'backing buffer stays native');
    assert(row.card.x >= row.map.x && row.card.x + row.card.width <= row.map.x + row.map.width + 0.15);
    assert(row.card.y + row.card.height < row.map.y + row.map.height);
    assert.equal(row.rows, 2, 'card contains distance and one caption row');
    assert.equal(row.unsupportedRows, false, 'no unsupported instruction/street/then rows');
    near(row.card.height, 62 * nativeScale, 'native-sized populated turn card');
    assert(row.caption.x + row.caption.width <= row.card.x + row.card.width);
    assert(row.caption.y + row.caption.height <= row.card.y + row.card.height);
    assert.equal(row.captionOverflow, 'hidden', 'long caption stays bounded');
    if (row.captionText !== 'Go straight') assert(row.captionScrollWidth > row.captionClientWidth, 'fixture really overflows and is clipped');
  }
  for (const row of rows.slice(1)) {
    const scale = row.map.width / rows[0].map.width;
    for (const key of ['card', 'arrow', 'track', 'metrics']) {
      near(row[key].height, rows[0][key].height * scale,
        `${key} scales with map`);
    }
    near(row.distanceFont, rows[0].distanceFont * scale, 'turn text scales with map');
    near(row.metricFont, rows[0].metricFont * scale, 'metric text scales with map');
  }
  console.log('PASS: 3:4 display, native two-row card, bounded captions, uniform overlays at 180, 252, 360 CSS px');
} finally {
  rmSync(temporary, { recursive:true, force:true });
}
