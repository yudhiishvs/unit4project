import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url).pathname;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const records = {
  101: {
    objectID: 101, title: 'Evening Garden', objectDate: '1889',
    department: 'European Paintings', medium: 'Oil on canvas',
    artistDisplayName: 'Ada Artist', primaryImageSmall: 'https://images.example/101.png',
    objectURL: 'https://museum.example/101',
  },
  202: {
    objectID: 202, title: 'Blue River', objectDate: '1904',
    department: 'American Paintings', medium: 'Watercolor',
    artistDisplayName: 'Ben Artist', primaryImageSmall: 'https://images.example/202.png',
    objectURL: 'https://museum.example/202',
  },
};

test('discover shows one matching artwork, skips banned values, and removes bans immediately', async () => {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    const file = join(root, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });

  try {
    const page = await browser.newPage();
    let searchCalls = 0;
    await page.route('**/public/collection/v1.1/search**', async (route) => {
      searchCalls += 1;
      await route.fulfill({ json: { total: 2, objectIDs: searchCalls === 1 ? [101] : [101, 202] } });
    });
    await page.route('**/public/collection/v1/objects/*', async (route) => {
      const id = Number(route.request().url().split('/').at(-1));
      await route.fulfill({ json: records[id] });
    });
    await page.route('https://images.example/**', (route) => route.fulfill({ body: png, contentType: 'image/png' }));

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole('button', { name: 'Discover a work' }).click();
    await page.getByTestId('artwork-title').getByText('Evening Garden').waitFor();
    assert.match(await page.locator('[data-testid="current-artwork"] img').getAttribute('src'), /101\.png/);
    assert.equal(await page.locator('[data-testid="current-artwork"] img').count(), 1);

    await page.getByRole('button', { name: 'Ban department European Paintings' }).click();
    await page.getByRole('button', { name: 'Remove European Paintings from ban list' }).waitFor();
    await page.getByRole('button', { name: 'Discover a work' }).click();
    await page.getByTestId('artwork-title').getByText('Blue River').waitFor();
    assert.match(await page.locator('[data-testid="current-artwork"] img').getAttribute('src'), /202\.png/);
    assert.match(await page.getByTestId('history-list').innerText(), /Evening Garden/);

    await page.getByRole('button', { name: 'Remove European Paintings from ban list' }).click();
    assert.equal(await page.getByRole('button', { name: 'Remove European Paintings from ban list' }).count(), 0);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
