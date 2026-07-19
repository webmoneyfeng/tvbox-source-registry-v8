const base = String(process.env.TVBOX_BASE || '').replace(/\/+$/u, '');
if (!base) throw new Error('TVBOX_BASE is required');

async function get(pathname) {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(base + pathname, { redirect: 'follow' });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch {}
      return { status: response.status, body, text, attempts: attempt, error: '' };
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  return { status: 0, body: null, text: '', attempts: 3, error: lastError };
}

const config = await get('/config.json');
const status = await get('/status.json');
const sources = await get('/sources.json');
const live = await get('/live.txt');
const checks = [
  ['config status', config.status === 200],
  ['config sites', Boolean(config.body && Array.isArray(config.body.sites) && config.body.sites.length > 0)],
  ['config direct APIs', Boolean(config.body?.sites?.every((site) => /^https?:\/\//u.test(site.api)))],
  ['status status', status.status === 200],
  ['sources status', sources.status === 200],
  ['live status', live.status === 200],
  ['live format', /^#EXTM3U/mu.test(live.text)],
  ['single quick search', config.body?.sites?.filter((site) => site.quickSearch === 1).length === 1],
  ['no executable sites', Boolean(config.body?.sites?.every((site) => !site.jar && !site.spider && !site.ext))],
];
const result = { base, checks: Object.fromEntries(checks), config: config.body, status: status.body, sources: sources.body, live: { status: live.status, length: live.text.length } };
console.log(JSON.stringify(result, null, 2));
if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
