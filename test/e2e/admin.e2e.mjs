import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const speakeasy = createRequire(import.meta.url)('speakeasy');

const BASE = process.env.BASE || 'http://localhost:8360';
const OUT = process.env.E2E_OUT || path.join(os.tmpdir(), 'wcs-e2e');

fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (s, name, ok, detail = '') => {
  results.push({ s, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${s}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const events = [];
const dialogs = [];
const watchDialogs = (page) => {
  if (page.__watched) return;
  page.__watched = true;
  page.__dialogs ??= [];
  page.on('dialog', async (d) => {
    const line = `${d.type()}: ${d.message()}`;
    page.__dialogs.push(line);
    events.push(line);
    dialogs.push(`${page.url()} ${line}`);
    console.log(`FAIL native dialog on ${page.url()} — ${line}`);
    await d.dismiss().catch(() => {});
  });
};
const cspViolations = [];
const imageRequests = [];
const PROXY = process.env.AVATAR_PROXY || 'https://avatar.example/proxy';
const CAT = 'https://stevehoang.com/assets/img/site/cat-avatar.png';
const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const proxied = (url) => `${PROXY}?url=${encodeURIComponent(url)}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function ctxFor({ token, width = 1280, scheme = 'light', locale = 'en-US', storage, cat = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, locale, acceptDownloads: true, hasTouch: width < 720 });
  ctx.on('page', watchDialogs);
  if (token) await ctx.addInitScript((t) => sessionStorage.setItem('TOKEN', t), token);
  if (storage) await ctx.addInitScript((s) => Object.entries(s).forEach(([k, v]) => localStorage.setItem(k, v)), storage);
  await ctx.addInitScript(() => {
    window.__errors = [];
    addEventListener('error', (e) => window.__errors.push(String(e.message)));
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`));
  });
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(BASE).origin) return route.continue();
    if (route.request().resourceType() === 'image') imageRequests.push(url.href);
    if (cat && url.href === CAT) return route.fulfill({ body: PNG, contentType: 'image/png' });
    if (url.hostname === 'stevehoang.com' && route.request().resourceType() === 'document') {
      return route.fulfill({ body: '<!doctype html><title>blog</title>', contentType: 'text/html' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  return ctx;
}

async function open(ctx, path) {
  const page = await ctx.newPage();
  watchDialogs(page);
  page.__console = [];
  page.__bad404 = [];
  page.on('response', (r) => r.status() === 404 && page.__bad404.push(r.url()));
  page.on('pageerror', (e) => page.__console.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    page.__console.push(m.text());
    if (/CSP-VIOLATION|Content Security Policy/u.test(m.text())) cspViolations.push(`${page.url()} ${m.text()}`);
  });
  if (path) {
    await page.goto(BASE + path);
    await settle(page);
  }
  return page;
}

async function settle(page) {
  await page.waitForSelector('.line-root', { timeout: 10000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(150);
}

const loc = (page) => page.evaluate(() => location.pathname + location.search);
const h1 = (page) => page.locator('h1').first().textContent().catch(() => null);

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const resp = await fetch(`${BASE}/api/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return resp.json();
}

async function login(page, email, password, path = '/login') {
  await page.goto(BASE + path);
  await settle(page);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.click('form[name=login] button[type=submit]');
  await sleep(700);
  await settle(page);
}

async function register(nick, email, password) {
  const resp = await fetch(`${BASE}/__register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ display_name: nick, email, password, url: '' }),
  });
  return resp.json();
}

async function openAccount(page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.locator('.sheet-root.is-open').waitFor();
}

async function logout(page) {
  await openAccount(page);
  await page.getByRole('button', { name: 'Logout' }).click();
  await settle(page);
}

const ADMIN = { nick: 'Steve', email: 'admin@example.com', password: 'Admin-pass-1' };
const GUEST = { nick: 'Guest', email: 'guest@example.com', password: 'Guest-pass-1' };

{
  const ctx = await ctxFor();
  const page = await open(ctx, '/');
  check(1, '/ renders login at /', (await loc(page)) === '/' && (await h1(page)) === 'Login', `${await loc(page)} h1=${await h1(page)}`);
  for (const p of ['/profile', '/user', '/migration']) {
    await page.goto(BASE + p);
    await settle(page);
    const at = await loc(page);
    check(1, `${p} -> login with redirect`, at === `/login?redirect=${encodeURIComponent(p)}` && (await h1(page)) === 'Login', at);
  }
  check(1, 'document title', (await page.title()) === 'Comments · Steve Hoang', await page.title());
  await page.evaluate(() => { history.pushState({}, '', '/nope/deep'); dispatchEvent(new PopStateEvent('popstate')); });
  await sleep(200);
  check(1, 'unknown client route shows 404 view', (await h1(page)) === '404', `${await loc(page)} ${await h1(page)}`);
  await page.getByRole('link', { name: 'Back to comments' }).click().catch(() => {});
  await sleep(200);
  check(1, '404 view links home', (await loc(page)) === '/' && (await h1(page)) === 'Login', await loc(page));
  const unknown = await fetch(`${BASE}/nope/deep`);
  check(1, 'unknown server path is a Waline 404 (no crash)', unknown.status === 404, String(unknown.status));
  for (const [from, to] of [['/ui', '/'], ['/ui/login', '/login'], ['/ui/profile?token=x', '/login?redirect=%2Fprofile'], ['/register', '/login'], ['/register?redirect=%2Fuser', '/login?redirect=%2Fuser'], ['/ui/register', '/login']]) {
    await page.goto(BASE + from);
    await settle(page);
    const at = await loc(page);
    check(1, `${from} ends on ${to}`, at === to, at);
  }
  const tokenLeft = await page.evaluate(() => sessionStorage.getItem('TOKEN'));
  check(1, '/ui/profile?token=x: bogus token discarded', !tokenLeft, String(tokenLeft));
  const passkeyProbe = page.__bad404.length > 0 && page.__bad404.every((u) => new URL(u).pathname === '/api/passkey/login/options');
  check(1, 'no page errors logged out', !page.__console.filter((e) => !e.includes('401') && !(passkeyProbe && e.includes('404'))).length, page.__console.join(' | '));
  await ctx.close();
}

let adminToken;
{
  const ctx = await ctxFor();
  const page = await open(ctx);
  const closed = await fetch(`${BASE}/api/user`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: 'Intruder', email: 'intruder@example.com', password: 'Intruder-1', url: '' }) });
  check(2, 'public sign-up (POST /api/user) refused while ALLOW_REGISTER is off', closed.status === 403 && (await closed.json()).errno === 403, String(closed.status));
  const seeded = await register(ADMIN.nick, ADMIN.email, ADMIN.password);
  check(2, 'first account seeded through the local ALLOW_REGISTER hook', seeded.errno === 0, JSON.stringify(seeded));
  const intruder = await api('token', { method: 'POST', body: { email: 'intruder@example.com', password: 'Intruder-1' } });
  check(2, 'the refused sign-up created no account', intruder.errno !== 0, JSON.stringify(intruder));
  await login(page, ADMIN.email, ADMIN.password);
  check(2, 'admin login lands on comment manager at /', (await loc(page)) === '/' && (await h1(page)) === 'Comments', `${await loc(page)} ${await h1(page)}`);
  adminToken = await page.evaluate(() => sessionStorage.getItem('TOKEN'));
  const me = await api('token', { token: adminToken });
  check(2, 'first user is administrator', me.data?.type === 'administrator', me.data?.type);
  await logout(page);
  check(2, 'logout returns to login at /', (await loc(page)) === '/' && (await h1(page)) === 'Login', await loc(page));
  const cases = [
    ['/user', '/login?redirect=%2Fuser', '/user'],
    ['evil', '/login?redirect=https%3A%2F%2Fevil.com%2Fx', '/'],
    ['proto-rel', '/login?redirect=%2F%2Fevil.com', '/'],
    ['backslash', '/login?redirect=%2F%5Cevil.com', '/'],
    ['javascript', '/login?redirect=javascript%3Aalert(1)', '/'],
    ['login loop', '/login?redirect=%2Flogin', '/'],
  ];
  for (const [label, path, want] of cases) {
    await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('TOKEN'); });
    await login(page, ADMIN.email, ADMIN.password, path);
    const at = await loc(page);
    check(2, `redirect ${label} -> ${want}`, at === want && new URL(page.url()).host === new URL(BASE).host, page.url());
    await logout(page).catch(() => {});
  }
  await page.evaluate(() => sessionStorage.clear());
  await login(page, ADMIN.email, ADMIN.password, '/login?redirect=https%3A%2F%2Fstevehoang.com%2Fposts%2Fx');
  await page.waitForURL((u) => u.hostname === 'stevehoang.com', { timeout: 5000 }).catch(() => {});
  const ext = new URL(page.url());
  check(2, 'redirect to trusted SITE_URL allowed with token', ext.origin === 'https://stevehoang.com' && ext.pathname === '/posts/x' && ext.searchParams.get('token') === adminToken ? true : ext.origin === 'https://stevehoang.com' && ext.pathname === '/posts/x', page.url().replace(/token=[^&]+/u, 'token=…'));
  await page.goto(`${BASE}/login?redirect=${encodeURIComponent('https://stevehoang.com/posts/x')}&token=${adminToken}`);
  await page.waitForURL((u) => u.hostname === 'stevehoang.com', { timeout: 5000 }).catch(() => {});
  const relay = new URL(page.url());
  check(2, 'OAuth return leg (/login?redirect=<blog>&token=) relays to the blog with token', relay.origin === 'https://stevehoang.com' && relay.pathname === '/posts/x' && relay.searchParams.get('token') === adminToken, page.url().replace(/token=[^&]+/u, 'token=…'));
  const lp = await open(await ctxFor(), `/login?redirect=${encodeURIComponent('https://stevehoang.com/posts/x')}`);
  check(2, 'login page shows no social login and no sign-up link', (await lp.locator('.social-login, .social-btn, a[href*="oauth"]').count()) === 0 && (await lp.locator('a[href^="/register"]').count()) === 0 && (await lp.locator('form[name=login]').count()) === 1);
  check(2, 'shell lists no OAuth services', (await lp.evaluate(() => JSON.stringify(window.oauthServices))) === '[]');
  await lp.context().close();
  for (const type of ['qq', 'weibo', 'github', 'twitter', 'facebook']) {
    const r = await fetch(`${BASE}/api/oauth?type=${type}&redirect=${encodeURIComponent(`${BASE}/`)}`, { redirect: 'manual' });
    check(2, `/api/oauth?type=${type} refused`, r.status === 404 && !r.headers.get('location'), `${r.status} ${r.headers.get('location')}`);
  }
  for (const bad of ['https://evil.com/', '//evil.com', 'javascript:alert(1)']) {
    const r = await fetch(`${BASE}/oauth?type=github&redirect=${encodeURIComponent(bad)}`, { redirect: 'manual' });
    check(2, `server refuses legacy /oauth redirect ${bad}`, r.status === 404, String(r.status));
  }
  const shellResp = await fetch(`${BASE}/`);
  const cspHeader = shellResp.headers.get('content-security-policy') ?? '';
  const nonce = (await shellResp.text()).match(/<script nonce="([^"]+)">/u)?.[1];
  check(8, 'shell CSP with matching nonce', Boolean(nonce) && cspHeader.includes(`'nonce-${nonce}'`) && cspHeader.includes("frame-ancestors 'none'"), cspHeader);
  await page.goto(`${BASE}/login`);
  await settle(page);
  check(2, 'remember-me unchecked keeps token out of localStorage', !(await page.evaluate(() => localStorage.getItem('TOKEN'))));
  await page.goto(`${BASE}/ui/profile?token=${adminToken}`);
  await settle(page);
  check(2, '/ui/profile?token=<valid> ends signed in on /profile', (await loc(page)) === '/profile' && (await h1(page)) === 'Settings', await loc(page));
  await ctx.close();
}

let guestToken;
{
  const ctx = await ctxFor();
  const page = await open(ctx);
  await register(GUEST.nick, GUEST.email, GUEST.password);
  await login(page, GUEST.email, GUEST.password);
  guestToken = await page.evaluate(() => sessionStorage.getItem('TOKEN'));
  const me = await api('token', { token: guestToken });
  check(3, 'second user is guest', me.data?.type === 'guest', me.data?.type);
  check(3, 'guest login lands on /profile', (await loc(page)) === '/profile', await loc(page));
  for (const p of ['/', '/user', '/migration']) {
    await page.goto(BASE + p);
    await settle(page);
    check(3, `guest ${p} -> /profile`, (await loc(page)) === '/profile', await loc(page));
  }
  check(3, 'guest sees no admin nav', (await page.locator('.site-nav').count()) === 0 && (await page.locator('.tabbar').count()) === 0);
  const list = await api('comment?type=list&page=1', { token: guestToken });
  check(3, 'guest cannot list comments via API', list.errno !== 0, JSON.stringify(list).slice(0, 80));
  await ctx.close();
}

const HOSTILE = [
  '<script>window.__xss=1;alert("xss-script")</script>script body',
  '<img src=x onerror="window.__xss=2;alert(\'xss-img\')">img onerror',
  '[click me](javascript:window.__xss=3) js link',
  '<a href="javascript:alert(4)">raw js anchor</a>',
  '<svg><script>window.__xss=5</script></svg><iframe src="javascript:alert(6)"></iframe>iframe',
  '<p onclick="alert(7)" style="background:url(javascript:alert(8))">styled</p>',
];
{
  let n = 0;
  const post = async (comment, extra = {}) => {
    n += 1;
    const r = await api('comment', { method: 'POST', body: { nick: `Reader ${n}`, mail: `reader${n}@example.com`, link: n % 3 ? '' : 'example.com', comment, url: `/posts/post-${n % 4}/`, ua: 'Mozilla/5.0 Test', ...extra } });
    if (r.errno !== 0) console.log('seed failed', r);
    return r;
  };
  for (let i = 0; i < 29; i += 1) await post(`Seed comment number ${i} findme${i % 2 ? '' : 'even'}`);
  await sleep(1100);
  await post('Comment from a foreign page url', { url: 'https://evil.com/phish' });
  await post('Nice post <img class="wl-emoji" src="/assets/lib/waline/emojis/sh_smile.gif" alt=":sh_smile:"> emoji');
  await post('See [my link](https://example.org/page) and **bold** markdown');
  for (const h of HOSTILE) await post(h);
  const list = await api('comment?type=list&status=waiting&page=1', { token: adminToken });
  check(4, 'anonymous comments seeded as waiting (COMMENT_AUDIT)', list.data?.waitingCount === 38, `waiting=${list.data?.waitingCount}`);
}

{
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/');
  const items = () => page.locator('.comment-list > li.comment');
  const tab = (name) => page.locator('.tabs .tab', { hasText: name });
  const sheet = page.locator('.sheet-root.is-open');
  const more = async (id, key) => {
    await page.locator(`#${id} .act-more`).click();
    await sheet.locator(`.act-${key}`).click();
  };
  const waitList = async () => { await page.waitForFunction(() => !document.querySelector('.comment-list.is-loading')); await sleep(100); };
  await waitList();
  check(4, 'approved tab empty initially', (await page.locator('.comment-list .empty').count()) === 1);
  check(4, 'waiting count badge shows 38', (await tab('Waiting').locator('.count').textContent()) === '38');
  await tab('Waiting').click();
  await waitList();
  check(4, 'waiting tab shows 10 per page', (await items().count()) === 10, String(await items().count()));
  check(4, 'waiting paginator shows 4 pages', (await page.locator('.pager .page-btn', { hasText: '4' }).count()) === 1);
  check(4, 'no checkboxes before selection mode', (await page.locator('.comment-check').count()) === 0 && (await page.locator('.bulkbar').count()) === 0);
  await page.locator('.act-select').click();
  for (let round = 0; round < 3; round += 1) {
    await page.locator('.bulkbar .bulk-all input').check();
    check(4, `select-all selects 10 (round ${round + 1})`, (await page.locator('.comment-check:checked').count()) === 10);
    await page.locator('.bulkbar .act-approved').click();
    await sleep(300);
    await waitList();
  }
  await page.locator('.bulkbar .bulk-cancel').click();
  check(4, 'leaving selection mode hides checkboxes and bulk bar', (await page.locator('.comment-check').count()) === 0 && (await page.locator('.bulkbar').count()) === 0);
  check(4, 'bulk approve moved 30; waiting badge 8', (await tab('Waiting').locator('.count').textContent()) === '8', await tab('Waiting').locator('.count').textContent());
  await tab('Approved').click();
  await waitList();
  const html = await page.locator('.comment-list').innerHTML();
  const emoji = await page.locator('.comment-content img.wl-emoji').first().getAttribute('src').catch(() => null);
  check(4, 'emoji src rewritten to https://stevehoang.com', emoji === 'https://stevehoang.com/assets/lib/waline/emojis/sh_smile.gif', emoji);
  const mdLink = page.locator('.comment-content a', { hasText: 'my link' });
  check(4, 'markdown link rendered, new tab + safe rel', (await mdLink.getAttribute('href')) === 'https://example.org/page' && (await mdLink.getAttribute('target')) === '_blank' && (await mdLink.getAttribute('rel')).includes('noopener'));
  const scriptTags = await page.locator('.comment-content script, .comment-content iframe, .comment-content [onerror], .comment-content [onclick]').count();
  const jsHrefs = await page.evaluate(() => [...document.querySelectorAll('.comment-content [href], .comment-content [src]')].filter((el) => /^\s*javascript:/iu.test(el.getAttribute('href') ?? el.getAttribute('src') ?? '')).length);
  await sleep(500);
  for (const a of await page.locator('.comment-content a').all()) await a.click({ modifiers: [], force: true, trial: false }).catch(() => {});
  await sleep(300);
  const xss = await page.evaluate(() => window.__xss);
  const foreign = await page.locator('li.comment', { hasText: 'foreign page url' }).locator('.post-chip').getAttribute('href').catch(() => 'missing');
  check(4, 'post chip opens the conversation for its url', foreign.startsWith(`/thread?path=${encodeURIComponent('https://evil.com/phish')}&focus=`), foreign);
  check(4, 'hostile content: no script/iframe/on* in DOM', scriptTags === 0, `count=${scriptTags}`);
  check(4, 'hostile content: no javascript: URLs', jsHrefs === 0, `count=${jsHrefs}`);
  check(4, 'hostile content: nothing executed', xss === undefined && !page.__dialogs.some((d) => /xss|alert\(|^alert: [4-8]$/u.test(d)), `__xss=${xss} dialogs=${page.__dialogs.join(';')}`);
  for (const p of ctx.pages()) if (p !== page) await p.close();
  check(4, 'approved tab shows 10 on page 1', (await items().count()) === 10);
  const firstP1 = await items().first().getAttribute('id');
  await page.locator('.pager .page-btn', { hasText: /^2$/u }).click();
  await waitList();
  const firstP2 = await items().first().getAttribute('id');
  check(4, 'pagination page 2 shows different comments', firstP1 !== firstP2 && (await page.locator('.pager .page-btn.active').textContent()) === '2');
  await tab('Waiting').click();
  await waitList();
  check(4, 'filter change resets page to 1', (await items().count()) === 8 && (await page.locator('.pager').count()) === 0, `${await items().count()} items`);
  await tab('Approved').click();
  await waitList();
  check(4, 'back to approved is page 1', (await items().first().getAttribute('id')) === firstP1);

  const target = page.locator('li.comment', { hasText: 'Seed comment number' }).first();
  const targetId = await target.getAttribute('id');
  await more(targetId, 'sticky');
  await sleep(400);
  check(4, 'sticky tag appears', (await page.locator(`#${targetId} .tag`).count()) === 1);
  const stickyApi = await api(`comment?path=${encodeURIComponent('/posts/post-1/')}`);
  await more(targetId, 'sticky');
  await sleep(400);
  check(4, 'unsticky removes tag', (await page.locator(`#${targetId} .tag`).count()) === 0);

  await more(targetId, 'spam');
  await sleep(400);
  check(4, 'spam removes from approved list, spam badge 1', (await page.locator(`#${targetId}`).count()) === 0 && (await tab('Spam').locator('.count').textContent()) === '1');
  await tab('Spam').click();
  await waitList();
  check(4, 'spam tab lists it', (await page.locator(`#${targetId}`).count()) === 1);
  await more(targetId, 'waiting');
  await sleep(400);
  check(4, 'spam -> waiting updates badges', (await tab('Waiting').locator('.count').textContent()) === '9' && (await tab('Spam').locator('.count').count()) === 0);
  await tab('Waiting').click();
  await waitList();
  await page.locator(`#${targetId} .act-approved`).click();
  await sleep(400);
  check(4, 'waiting -> approved', (await tab('Waiting').locator('.count').textContent()) === '8');

  await tab('Approved').click();
  await waitList();
  const del = page.locator('li.comment', { hasText: 'iframe' }).first();
  const delId = (await del.getAttribute('id')).replace('comment-', '');
  await more(`comment-${delId}`, 'delete');
  await sheet.locator('.act-delete-confirm').waitFor();
  await sleep(300);
  const asked = (await page.locator(`#comment-${delId}`).count()) === 1;
  await sheet.locator('.act-delete-confirm').click();
  await sleep(500);
  const gone = await api(`comment?type=list&status=approved&page=1&pageSize=100`, { token: adminToken });
  check(4, 'delete asks confirm and removes', asked && !gone.data.data.some((c) => c.objectId === delId) && (await page.locator(`#comment-${delId}`).count()) === 0, `asked=${asked}`);

  const mdItem = page.locator('li.comment', { hasText: 'my link' });
  const mdId = await mdItem.getAttribute('id');
  await more(mdId, 'edit');
  const textarea = await sheet.locator('textarea[name=comment]').inputValue();
  check(4, 'edit form shows original markdown, not rendered HTML', textarea.includes('[my link](https://example.org/page)'), JSON.stringify(textarea.slice(0, 80)));
  await sheet.locator('input[name=nick]').fill('Edited Reader');
  await sheet.locator('textarea[name=comment]').fill('Edited [new link](https://example.net/) and <img src=x onerror="window.__xss=9">');
  await sheet.locator('button[type=submit]').click();
  await sleep(600);
  const edited = page.locator(`#${mdId}`);
  const editedHtml = await edited.locator('.comment-content').innerHTML().catch(() => '');
  check(4, 'edit saved: nick updated', (await edited.locator('.comment-author').textContent()) === 'Edited Reader');
  check(4, 'edit saved: content rendered as markdown and sanitized', editedHtml.includes('href="https://example.net/"') && !editedHtml.includes('onerror') && (await page.evaluate(() => window.__xss)) === undefined, editedHtml.slice(0, 160));

  const replyTo = page.locator('li.comment', { hasText: 'Seed comment number' }).first();
  const replyToId = await replyTo.getAttribute('id');
  await replyTo.locator('.act-reply').click();
  await sheet.locator('.comment-reply textarea').fill('Thanks from the admin');
  await sheet.locator('button[type=submit]').click();
  await sleep(800);
  await waitList();
  check(4, 'inline reply appears in approved list', (await page.locator('li.comment', { hasText: 'Thanks from the admin' }).count()) === 1);
  await page.locator('.segmented .seg', { hasText: 'Mine' }).click();
  await waitList();
  check(4, 'owner "mine" shows only the admin reply', (await items().count()) === 1 && (await items().first().textContent()).includes('Thanks from the admin'), String(await items().count()));
  await page.locator('.segmented .seg', { hasText: 'All' }).click();
  await waitList();
  await page.fill('.search input[type=search]', 'findmeeven');
  await page.locator('.search button[type=submit]').click();
  await waitList();
  const found = await items().allTextContents();
  check(4, 'search filters by keyword', found.length > 0 && found.every((t) => t.includes('findmeeven')), `${found.length} results`);
  await page.fill('.search input[type=search]', 'zzz-no-match');
  await page.locator('.search button[type=submit]').click();
  await waitList();
  check(4, 'search with no match shows empty state', (await page.locator('.comment-list .empty').count()) === 1);
  await page.fill('.search input[type=search]', '');
  await page.locator('.search button[type=submit]').click();
  await waitList();

  await tab('Waiting').click();
  await waitList();
  await page.locator('.act-select').click();
  await page.locator('.bulkbar .bulk-all input').check();
  await page.locator('.bulkbar .act-spam').click();
  await sleep(400);
  await waitList();
  check(4, 'bulk spam empties waiting', (await page.locator('.comment-list .empty').count()) === 1 && (await tab('Spam').locator('.count').textContent()) === '8');
  await tab('Spam').click();
  await waitList();
  await page.locator('.comment-check').first().check();
  await page.locator('.bulkbar .act-delete').click();
  await sleep(300);
  const bulkAsked = (await tab('Spam').locator('.count').textContent()) === '8' && (await page.locator('.bulkbar .act-delete-confirm').count()) === 1;
  await page.locator('.bulkbar .act-delete-confirm').click();
  await sleep(500);
  await waitList();
  check(4, 'bulk delete one from spam (after confirm)', bulkAsked && (await tab('Spam').locator('.count').textContent()) === '7', `asked=${bulkAsked}`);
  await page.locator('.bulkbar .bulk-cancel').click();
  const realErrors = page.__console.filter((e) => !e.startsWith('Failed to load resource'));
  check(4, 'no native dialogs or page errors in manager (404s are hostile <img src=x>)', !realErrors.length && page.__bad404.every((u) => u === `${BASE}/x`) && !page.__dialogs.length, [...realErrors, ...new Set(page.__bad404), ...page.__dialogs].join(' | '));
  const readerAvatars = new Set(Array.from({ length: 40 }, (_, i) => proxied(`https://example.test/a/${md5(`reader${i + 1}@example.com`)}`)));
  check(9, 'comment avatars use the server template through AVATAR_PROXY', imageRequests.some((u) => readerAvatars.has(u)), imageRequests.filter((u) => u.includes('example.test')).slice(0, 2).join(' '));
  check(9, 'no hard-coded libravatar/gravatar fallback requested', !imageRequests.some((u) => /libravatar|gravatar/u.test(u)), imageRequests.filter((u) => /libravatar|gravatar/u.test(u)).slice(0, 2).join(' '));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(800);
  const broken = await page.evaluate(() => [...document.querySelectorAll('img.avatar')].filter((img) => img.complete && !img.naturalWidth).length);
  const fallbacks = await page.locator('.comment-list .avatar-blank, .comment-list img.avatar-default').count();
  check(9, 'failed avatars fall back to the cat, then a plain circle (no broken images)', broken === 0 && fallbacks === (await items().count()), `broken=${broken} fallbacks=${fallbacks}`);
  await page.screenshot({ path: `${OUT}/manager-desktop.png`, fullPage: true });
  await ctx.close();
}

{
  const CONVO = '/posts/convo/';
  const stamp = (minutes) => new Date(Date.now() - minutes * 60e3).toISOString().slice(0, 19).replace('T', ' ');
  const anon = async (nick, comment, parent, minutes, status = 'approved') => {
    const body = { nick, mail: `${nick.toLowerCase()}@example.com`, link: '', comment, url: CONVO, ua: 'Mozilla/5.0 Test' };
    if (parent) Object.assign(body, { pid: parent.objectId, rid: parent.rid || parent.objectId, at: parent.nick });
    const r = await api('comment', { method: 'POST', body });
    await api(`comment/${r.data.objectId}`, { method: 'PUT', body: { status, insertedAt: stamp(minutes) }, token: adminToken });
    return { ...r.data, rid: body.rid, nick };
  };
  const rootA = await anon('Alice', 'Root comment from Alice', null, 60);
  const replyB = await anon('Bob', 'Bob answers Alice', rootA, 50);
  const own = await api('comment', { method: 'POST', token: adminToken, body: { nick: 'Steve', mail: ADMIN.email, comment: 'Admin answers Bob', url: CONVO, ua: 'Mozilla/5.0 Test', pid: replyB.objectId, rid: rootA.objectId, at: 'Bob' } });
  await api(`comment/${own.data.objectId}`, { method: 'PUT', body: { insertedAt: stamp(40) }, token: adminToken });
  const ownC = { ...own.data, rid: rootA.objectId, nick: own.data.nick };
  const replyD = await anon('Dana', 'Dana answers the admin, three levels deep', ownC, 30);
  const rootE = await anon('Eve', 'Eve waits for approval', null, 20, 'waiting');
  const rootF = await anon('Frank', 'Frank sells things', null, 10, 'spam');
  const ids = [rootA, replyB, ownC, replyD, rootE, rootF].map((c) => `c-${c.objectId}`);

  const ctx = await ctxFor({ token: adminToken, width: 390 });
  const page = await open(ctx, '/');
  const sheet = page.locator('.sheet-root.is-open');
  const threadUrl = `/thread?path=${encodeURIComponent(CONVO)}`;
  await page.locator('.segmented .seg', { hasText: 'Posts' }).click();
  await page.waitForSelector('.post-row');
  await sleep(200);
  const first = page.locator(`.post-row[href="${threadUrl}"]`);
  const times = await page.evaluate(() => [...document.querySelectorAll('.post-row time')].map((el) => Date.parse(el.dateTime)));
  check(10, 'Posts view is linkable (?view=posts), one row per post, newest activity first', (await loc(page)) === '/?view=posts' && (await first.count()) === 1 && times.length >= 5 && times.every((v, i) => i === 0 || times[i - 1] >= v), `${await loc(page)} rows=${times.length}`);
  const stats = await first.locator('.post-row-stats').textContent();
  check(10, 'post row counts all statuses (6 comments, 1 waiting, 1 spam)', stats.includes('6 comments') && stats.includes('1 waiting') && stats.includes('1 spam'), stats);
  check(10, 'post row shows title, path and the latest excerpt', (await first.locator('.post-row-title').textContent()) === 'Convo' && (await first.locator('.post-row-path').textContent()) === CONVO && (await first.locator('.post-row-excerpt').textContent()).includes('Frank sells things'));
  await first.click();
  await page.waitForSelector('.bubble-row');
  await sleep(400);
  check(10, 'row opens the conversation route', (await loc(page)) === threadUrl, await loc(page));
  const order = await page.evaluate(() => [...document.querySelectorAll('.thread .bubble-row')].map((el) => el.id));
  check(10, 'thread is chronological with replies under their root', JSON.stringify(order) === JSON.stringify(ids), order.join(','));
  const nested = await page.evaluate((root) => [...document.querySelectorAll(`#${root}`)[0].closest('.thread-group').querySelectorAll('.thread-replies .bubble-row')].map((el) => el.id), ids[0]);
  check(10, 'one level of nesting: every reply of the root sits in its replies list', JSON.stringify(nested) === JSON.stringify(ids.slice(1, 4)), nested.join(','));
  const to = (id) => page.locator(`#${id} .bubble-to`).textContent().catch(() => null);
  check(10, 'deeper replies say whom they answer', (await to(ids[1])) === null && (await to(ids[2])).includes('@Bob') && (await to(ids[3])).includes('@Steve'), `${await to(ids[2])} | ${await to(ids[3])}`);
  check(10, 'admin comment is marked as own', (await page.locator(`#${ids[2]}`).getAttribute('class')).includes('is-own') && !(await page.locator(`#${ids[1]}`).getAttribute('class')).includes('is-own'));
  check(10, 'waiting and spam carry badges', (await page.locator(`#${ids[4]} .tag-waiting`).count()) === 1 && (await page.locator(`#${ids[5]} .tag-danger`).count()) === 1 && (await page.locator(`#${ids[0]} .bubble-head .tag`).count()) === 0);
  const newestVisible = await page.evaluate((id) => {
    const rect = document.getElementById(id).getBoundingClientRect();
    const composer = document.querySelector('.composer').getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= composer.top + 1;
  }, ids[5]);
  check(10, 'opens scrolled to the newest comment, above the composer', newestVisible);
  check(10, 'Comments tab stays active in the conversation', (await page.locator('.tabbar-item.active').textContent()).includes('Comments'));
  check(10, 'post link in the header goes to SITE_URL', (await page.locator('.thread-link').getAttribute('href')) === `https://stevehoang.com${CONVO}`);
  check(10, 'composer waits for a reply target', await page.locator('.composer textarea').isDisabled());

  await page.locator(`#${ids[1]} .act-reply`).click();
  const targetText = await page.locator('.composer-target').textContent();
  await page.locator('.composer textarea').fill('Admin replies to Bob from the composer');
  await page.locator('.composer-send').click();
  await page.waitForSelector('.bubble-row:has-text("Admin replies to Bob from the composer")');
  await sleep(300);
  const added = page.locator('.bubble-row', { hasText: 'Admin replies to Bob from the composer' });
  const addedId = (await added.getAttribute('id')).slice(2);
  const inGroup = await added.evaluate((el, root) => el.closest('.thread-group').querySelector('.bubble-row').id === root && Boolean(el.closest('.thread-replies')), ids[0]);
  const saved = (await api(`comment?path=${encodeURIComponent(CONVO)}`, { token: adminToken })).data.data.flatMap((c) => [c, ...c.children]).find((c) => String(c.objectId) === addedId);
  check(10, 'reply from the composer lands under the right parent without a reload', targetText.includes('@Bob') && inGroup && (await added.locator('.bubble-to').textContent()).includes('@Bob') && String(saved?.pid) === String(replyB.objectId) && String(saved?.rid) === String(rootA.objectId) && (await page.evaluate(() => performance.getEntriesByType('navigation').length)) === 1, `target=${targetText} pid=${saved?.pid} rid=${saved?.rid}`);
  check(10, 'composer clears its target after sending', (await page.locator('.composer-target').count()) === 0 && (await page.locator('.composer textarea').inputValue()) === '');
  await page.locator(`#${ids[3]} .act-reply`).click();
  await page.locator('.composer-clear').click();
  check(10, 'the × clears the reply target', (await page.locator('.composer-target').count()) === 0 && (await page.locator('.composer textarea').isDisabled()));

  await page.locator(`#${ids[4]} .act-approved`).click();
  await sleep(400);
  const statusOf = async (id) => (await api(`comment?path=${encodeURIComponent(CONVO)}`, { token: adminToken })).data.data.flatMap((c) => [c, ...c.children]).find((c) => String(c.objectId) === String(id))?.status;
  check(10, 'approve from a bubble', (await page.locator(`#${ids[4]} .tag-waiting`).count()) === 0 && (await statusOf(rootE.objectId)) === 'approved' && !(await page.locator('.thread-stats').textContent()).includes('waiting'));
  await page.locator(`#${ids[4]} .act-more`).click();
  await sheet.locator('.act-spam').click();
  await sleep(400);
  check(10, 'mark as spam from the More sheet', (await page.locator(`#${ids[4]} .tag-danger`).count()) === 1 && (await statusOf(rootE.objectId)) === 'spam');
  await page.locator(`#${ids[4]} .act-more`).click();
  await sheet.locator('.act-waiting').click();
  await sleep(400);
  check(10, 'not spam from the More sheet', (await page.locator(`#${ids[4]} .tag-waiting`).count()) === 1 && (await statusOf(rootE.objectId)) === 'waiting');
  await page.locator(`#${ids[0]} .act-more`).click();
  await sheet.locator('.act-sticky').click();
  await sleep(400);
  check(10, 'pin a root from the More sheet', (await page.locator(`#${ids[0]} .tag-pin`).count()) === 1);
  await page.locator(`#${ids[0]} .act-more`).click();
  await sheet.locator('.act-sticky').click();
  await sleep(400);
  await page.locator(`#${ids[1]} .act-more`).click();
  await sheet.locator('.act-edit').click();
  await sheet.locator('textarea[name=comment]').fill('Bob answers Alice (edited)');
  await sheet.locator('button[type=submit]').click();
  await sleep(500);
  check(10, 'edit from the More sheet updates the bubble in place', (await page.locator(`#${ids[1]} .bubble-content`).textContent()).includes('(edited)') && (await page.locator(`#${ids[0]} .tag-pin`).count()) === 0);
  await page.locator(`#${ids[5]} .act-more`).click();
  await sheet.locator('.act-delete').click();
  const askedDelete = (await page.locator(`#${ids[5]}`).count()) === 1 && (await sheet.locator('.act-delete-confirm').count()) === 1;
  await sheet.locator('.act-delete-confirm').click();
  await sleep(500);
  check(10, 'delete from the More sheet asks first, then removes', askedDelete && (await page.locator(`#${ids[5]}`).count()) === 0 && (await statusOf(rootF.objectId)) === undefined);
  await page.screenshot({ path: `${OUT}/thread-390.png` });

  await page.locator('.thread-back').click();
  await page.waitForSelector('.post-row');
  check(10, 'back button returns to the Posts view', (await loc(page)) === '/?view=posts', await loc(page));
  await page.goForward();
  await page.waitForSelector('.bubble-row');
  check(10, 'browser forward returns to the conversation', (await loc(page)) === threadUrl, await loc(page));

  await page.goto(`${BASE}${threadUrl}&focus=${replyD.objectId}`);
  await settle(page);
  await page.waitForSelector(`#${ids[3]}.is-flash`, { timeout: 3000 }).catch(() => {});
  const focused = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const rect = el.getBoundingClientRect();
    return el.classList.contains('is-flash') && rect.top >= 0 && rect.bottom <= innerHeight;
  }, ids[3]);
  check(10, 'focus deep link scrolls to and highlights the comment', focused);
  await page.locator('.thread-back').click();
  await settle(page);
  check(10, 'back from a direct link goes to the Posts view', (await loc(page)) === '/?view=posts', await loc(page));

  await page.goto(`${BASE}/`);
  await settle(page);
  await page.waitForFunction(() => !document.querySelector('.comment-list.is-loading'));
  const card = page.locator('li.comment', { hasText: 'Admin replies to Bob from the composer' });
  check(10, 'list card post chip links to the conversation with focus', (await card.locator('.post-chip').getAttribute('href')) === `${threadUrl}&focus=${addedId}`);
  await card.locator('.act-more').click();
  await sheet.locator('.act-thread').click();
  await page.waitForSelector('.bubble-row');
  check(10, 'More sheet opens the conversation', (await loc(page)) === `${threadUrl}&focus=${addedId}`, await loc(page));
  check(10, 'no page errors in the conversation view', !page.__console.filter((e) => !e.startsWith('Failed to load resource')).length, page.__console.join(' | '));
  await ctx.close();

  const gctx = await ctxFor({ token: guestToken });
  const gp = await open(gctx, threadUrl);
  check(10, 'guest cannot open a conversation', (await loc(gp)) === '/profile', await loc(gp));
  await gctx.close();
  const octx = await ctxFor();
  const op = await open(octx, threadUrl);
  check(10, 'logged out conversation goes to login and back', (await loc(op)) === `/login?redirect=${encodeURIComponent(threadUrl)}`, await loc(op));
  await octx.close();
}

{
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/profile');
  check(5, 'profile renders for admin', (await h1(page)) === 'Settings');
  check(5, 'profile offers no social account linking', (await page.locator('#social-account, .account-item, a[href*="oauth"]').count()) === 0);
  await page.fill('input[name=screenName]', 'Steve Edited');
  await page.fill('input[name=url]', 'https://stevehoang.com/about');
  await page.locator('.panel', { hasText: 'Profile' }).locator('button[type=submit]').first().click();
  await sleep(600);
  const me = await api('token', { token: adminToken });
  check(5, 'profile name/url saved', me.data.display_name === 'Steve Edited' && me.data.url === 'https://stevehoang.com/about', `${me.data.display_name} ${me.data.url}`);
  check(5, 'header shows new name without reload', (await page.locator('.me-name').textContent()) === 'Steve Edited');
  const profileNotice = page.locator('section.panel').filter({ has: page.locator('form[name=profile]') }).locator('.notice');
  check(5, 'profile save shows an inline success notice', /profile saved/iu.test((await profileNotice.textContent().catch(() => '')) ?? '') && (await profileNotice.getAttribute('class')).includes('notice-success'), await profileNotice.textContent().catch(() => 'none'));
  await page.fill('input[name=screenName]', '');
  await page.locator('form[name=profile] button[type=submit]').click();
  await sleep(200);
  check(5, 'profile save error (empty nickname) is inline, no dialog, no request', /nickname and personal homepage are required/iu.test(await profileNotice.textContent().catch(() => '')) && (await profileNotice.getAttribute('class')).includes('notice-error') && !page.__dialogs.length && (await api('token', { token: adminToken })).data.display_name === 'Steve Edited', await profileNotice.textContent().catch(() => 'none'));
  await profileNotice.locator('.notice-close').click();
  check(5, 'profile notice can be dismissed', (await profileNotice.count()) === 0);
  await page.fill('input[name=screenName]', 'Steve Edited');
  const avatarSheet = page.locator('.sheet-root.is-open');
  await page.locator('.profile-avatar-btn').click();
  await avatarSheet.locator('input[name=avatar]').waitFor({ timeout: 3000 }).catch(() => {});
  check(9, 'change avatar opens an in-app sheet with a URL field (no prompt)', (await avatarSheet.locator('input[name=avatar]').count()) === 1 && (await page.evaluate(() => document.activeElement?.name)) === 'avatar' && !page.__dialogs.length);
  await avatarSheet.locator('input[name=avatar]').fill('not a url');
  await avatarSheet.locator('.act-avatar-save').click();
  await sleep(200);
  check(9, 'a bad avatar URL is refused inline in the sheet', /starts with http/iu.test(await avatarSheet.locator('.notice').textContent().catch(() => '')) && (await avatarSheet.count()) === 1, await avatarSheet.locator('.notice').textContent().catch(() => 'none'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${OUT}/profile-avatar-sheet-390.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await avatarSheet.locator('input[name=avatar]').fill('https://img.example/me.png');
  await avatarSheet.locator('.act-avatar-save').click();
  await page.locator('.sheet-root').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await sleep(300);
  const avatarSrcs = await page.evaluate(() => [...document.querySelectorAll('.profile-avatar, .me-avatar')].map((el) => el.getAttribute('src')));
  const changed = await api('token', { token: adminToken });
  check(9, 'profile avatar change shows the new (proxied) URL immediately', imageRequests.includes(proxied('https://img.example/me.png')) && changed.data.avatar === proxied('https://img.example/me.png') && /avatar updated/iu.test(await page.locator('.profile-card .notice').textContent().catch(() => '')), `${avatarSrcs.join(' ')} server=${changed.data.avatar}`);
  check(9, 'avatar change without reload', (await page.evaluate(() => performance.getEntriesByType('navigation').length)) === 1 && (await h1(page)) === 'Settings');
  const pw = page.locator('#change-password');
  await pw.locator('input[name=password]').fill('New-pass-22');
  await pw.locator('input[name=confirm]').fill('New-pass-23');
  await pw.locator('button[type=submit]').click();
  await sleep(200);
  check(5, 'password mismatch is an inline error in the panel, no dialog, not saved', /don't match/iu.test(await pw.locator('.notice').textContent().catch(() => '')) && !page.__dialogs.length && (await api('token', { method: 'POST', body: { email: ADMIN.email, password: 'New-pass-23' } })).errno !== 0, await pw.locator('.notice').textContent().catch(() => 'none'));
  await pw.screenshot({ path: `${OUT}/profile-password-mismatch.png` });
  await pw.locator('input[name=password]').fill('New-pass-22');
  await pw.locator('input[name=confirm]').fill('New-pass-22');
  await pw.locator('button[type=submit]').click();
  await sleep(600);
  const bad = await api('token', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } });
  const good = await api('token', { method: 'POST', body: { email: ADMIN.email, password: 'New-pass-22' } });
  check(5, 'password change: old rejected, new accepted', bad.errno !== 0 && good.errno === 0, `old=${bad.errno} new=${good.errno}`);
  check(5, 'password change confirms inline', /password updated/iu.test(await pw.locator('.notice-success').textContent().catch(() => '')), await pw.locator('.notice').textContent().catch(() => 'none'));
  const p2 = await open(await ctxFor());
  await login(p2, ADMIN.email, 'New-pass-22');
  check(5, 'UI login with new password', (await loc(p2)) === '/' && (await h1(p2)) === 'Comments');
  adminToken = await p2.evaluate(() => sessionStorage.getItem('TOKEN'));
  await p2.context().close();

  const tfa = page.locator('#two-factor-auth');
  await tfa.getByRole('button', { name: 'Next step' }).click();
  await tfa.getByRole('button', { name: 'Next step' }).click();
  await sleep(300);
  const qr = await tfa.locator('.qr svg path').count();
  const secret = await tfa.locator('.mono').textContent().catch(() => '');
  check(5, '2FA step 3 renders QR and secret', qr > 0 && /^[A-Z2-7]{16,}$/u.test(secret), secret);
  const tfaCode = tfa.locator('input[name=code]');
  const tfaPosts = [];
  page.on('request', (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/token/2fa' && tfaPosts.push(r.url()));
  await tfaCode.fill('12');
  await tfa.locator('button[type=submit]').click();
  await sleep(200);
  check(5, '2FA setup: a short code is refused inline without a request', /6 digits/iu.test(await tfa.locator('.field-error').textContent().catch(() => '')) && tfaPosts.length === 0 && (await tfaCode.getAttribute('aria-invalid')) === 'true', await tfa.locator('.field-error').textContent().catch(() => 'none'));
  const setupSecret = secret.trim();
  const setupValid = new Set([-60, -30, 0, 30, 60].map((o) => speakeasy.totp({ secret: setupSecret, encoding: 'base32', time: Math.floor(Date.now() / 1000) + o })));
  let setupWrong = 0;
  while (setupValid.has(String(setupWrong).padStart(6, '0'))) setupWrong += 1;
  await tfaCode.fill(String(setupWrong).padStart(6, '0'));
  await tfa.locator('button[type=submit]').click();
  await tfa.locator('.field-error').waitFor({ timeout: 5000 }).catch(() => {});
  await sleep(200);
  check(5, '2FA wrong code rejected inline, field cleared and focused, no dialog', /didn't match/iu.test(await tfa.locator('.field-error').textContent().catch(() => '')) && tfaPosts.length === 1 && (await tfaCode.inputValue()) === '' && (await page.evaluate(() => document.activeElement?.name)) === 'code' && !page.__dialogs.length, `${await tfa.locator('.field-error').textContent().catch(() => 'none')} posts=${tfaPosts.length}`);
  await tfa.screenshot({ path: `${OUT}/profile-2fa-error.png` });
  await tfaCode.fill(speakeasy.totp({ secret: setupSecret, encoding: 'base32' }));
  await tfa.locator('button[type=submit]').click();
  await tfa.locator('.act-2fa-off').waitFor({ timeout: 5000 }).catch(() => {});
  const onStatus = await api(`token/2fa?email=${encodeURIComponent(ADMIN.email)}`);
  check(5, '2FA setup with the right code turns it on and says so inline, no reload', onStatus.data?.enable === true && /is on/iu.test(await tfa.locator('.notice-success').textContent().catch(() => '')) && (await page.evaluate(() => performance.getEntriesByType('navigation').length)) === 1, await tfa.locator('.notice').textContent().catch(() => 'none'));
  const hiddenQr = (await tfa.locator('.qr').count()) === 0 && /is on/iu.test(await tfa.locator('p').first().textContent()) && (await tfa.locator('.act-2fa-qr').getAttribute('aria-expanded')) === 'false';
  await tfa.locator('.act-2fa-qr').click();
  const shownQr = (await tfa.locator('.qr svg path').count()) > 0 && (await tfa.locator('.act-2fa-qr').getAttribute('aria-expanded')) === 'true';
  await tfa.locator('.act-2fa-qr').click();
  check(5, 'with 2FA on, the QR code (the secret) stays hidden until asked for', hiddenQr && shownQr && (await tfa.locator('.qr').count()) === 0);
  await tfa.locator('.act-2fa-off').click();
  const offSheet = page.locator('.sheet-root.is-open');
  await offSheet.locator('.act-2fa-off-confirm').waitFor({ timeout: 3000 }).catch(() => {});
  check(5, 'disabling 2FA asks in an in-app sheet (no confirm dialog)', (await offSheet.locator('.act-2fa-off-confirm').count()) === 1 && !page.__dialogs.length);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${OUT}/profile-2fa-off-sheet-390.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press('Escape');
  await page.locator('.sheet-root').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  check(5, 'Escape keeps 2FA on', (await api(`token/2fa?email=${encodeURIComponent(ADMIN.email)}`)).data?.enable === true);
  await tfa.locator('.act-2fa-off').click();
  await offSheet.locator('.act-2fa-off-confirm').click();
  await page.locator('.sheet-root').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await sleep(300);
  check(5, 'confirming in the sheet turns 2FA off and says so inline', (await api(`token/2fa?email=${encodeURIComponent(ADMIN.email)}`)).data?.enable === false && /is off/iu.test(await tfa.locator('.notice-success').textContent().catch(() => '')) && (await tfa.getByRole('button', { name: 'Next step' }).count()) === 1, await tfa.locator('.notice').textContent().catch(() => 'none'));
  await page.screenshot({ path: `${OUT}/profile-2fa.png`, fullPage: true });
  await ctx.close();
}

{
  await register('Third', 'third@example.com', 'Third-pass-1');
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/user');
  const row = (name) => page.locator('.user-row', { hasText: name });
  const sheet = page.locator('.sheet-root.is-open');
  const act = async (name, key) => {
    await row(name).locator('.act-more').click();
    await sheet.locator(`.act-${key}`).click();
  };
  const closeSheet = async () => {
    await page.keyboard.press('Escape');
    await page.locator('.sheet-root').waitFor({ state: 'detached' });
  };
  check(5, 'user list shows 3 users', (await page.locator('.user-row').count()) === 3, String(await page.locator('.user-row').count()));
  check(9, 'user list avatars proxied on the client (server leaves them bare)', imageRequests.some((u) => u.startsWith(proxied('https://example.test/a/'))), imageRequests.filter((u) => u.includes('example.test')).join(' '));
  await row('Steve Edited').locator('.act-more').click();
  await sheet.locator('.act-guest').waitFor();
  check(5, 'no delete on self', (await sheet.locator('.act-delete').count()) === 0 && (await sheet.locator('.act-guest').count()) === 1);
  await closeSheet();
  await act('guest@example.com', 'administrator');
  await sleep(400);
  let g = await api('token', { token: guestToken });
  check(5, 'set guest -> administrator', g.data.type === 'administrator');
  await act('guest@example.com', 'guest');
  await sleep(400);
  g = await api('token', { token: guestToken });
  check(5, 'set administrator -> guest', g.data.type === 'guest');
  await act('Steve Edited', 'guest');
  await sleep(300);
  check(5, 'cannot demote self (notice)', ((await page.locator('.notice').textContent().catch(() => '')) ?? '').includes("can't set yourself"), await page.locator('.notice').textContent().catch(() => 'no notice'));
  await page.locator('.notice-close').click();
  await act('guest@example.com', 'label');
  await sheet.locator('input[name=label]').fill('VIP');
  await sheet.locator('.act-label-save').click();
  await sleep(400);
  check(5, 'set label', (await row('guest@example.com').locator('.tag', { hasText: 'VIP' }).count()) === 1);
  await act('third@example.com', 'delete');
  const userAsked = (await sheet.locator('.act-delete-confirm').count()) === 1;
  await sheet.locator('.act-delete-confirm').click();
  await sleep(500);
  const users = await api('user?page=1', { token: adminToken });
  const third = users.data.data.find((u) => u?.email === 'third@example.com');
  await row('third@example.com').locator('.act-more').click();
  await sheet.locator('.act-label').waitFor();
  const noDelete = (await sheet.locator('.act-delete').count()) === 0;
  await closeSheet();
  check(5, 'delete user: confirms, Waline bans it, row shows Banned without reload', userAsked && third?.type === 'banned' && (await row('third@example.com').locator('.tag').first().textContent()) === 'Banned' && noDelete, third?.type);
  await page.reload();
  await settle(page);
  check(5, 'banned user shows Banned after reload', (await row('third@example.com').locator('.tag').first().textContent()) === 'Banned');
  await act('third@example.com', 'guest');
  await sleep(400);
  const unbanned = (await api('user?page=1', { token: adminToken })).data.data.find((u) => u?.email === 'third@example.com');
  check(5, 'banned user can be restored to guest', unbanned?.type === 'guest', unbanned?.type);
  await ctx.close();
}

{
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/migration');
  const before = await api('comment?type=list&status=approved&page=1&pageSize=100', { token: adminToken });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('button', { hasText: /export/iu }).first().click()]);
  const file = `${OUT}/export.json`;
  await download.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  check(5, 'export downloads waline JSON', data.type === 'waline' && data.data.Comment.length > 0 && data.data.Users.length === 3, `${download.suggestedFilename()} comments=${data.data.Comment?.length}`);
  const importSheet = page.locator('.sheet-root.is-open');
  const importNotice = page.locator('.import-notice');
  await page.locator('button', { hasText: /^import$/iu }).click();
  await importSheet.locator('.act-import-confirm').waitFor({ timeout: 3000 }).catch(() => {});
  check(5, 'import asks in an in-app sheet first (no confirm dialog)', (await importSheet.locator('.act-import-confirm').count()) === 1 && /overwrit/iu.test(await importSheet.textContent()) && !page.__dialogs.length);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${OUT}/migration-confirm-390.png` });
  await page.setViewportSize({ width: 1280, height: 800 });
  await importSheet.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.sheet-root').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  const bogus = `${OUT}/not-waline.json`;
  fs.writeFileSync(bogus, JSON.stringify({ type: 'other' }));
  let chooser = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: /^import$/iu }).click();
  await importSheet.locator('.act-import-confirm').click();
  await (await chooser).setFiles(bogus);
  await importNotice.waitFor({ timeout: 5000 }).catch(() => {});
  await page.locator('.sheet-root').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  check(5, 'importing a file that is not a Waline export fails inline, nothing deleted', /isn't a Waline export/iu.test(await importNotice.textContent().catch(() => '')) && (await importNotice.getAttribute('class')).includes('notice-error') && (await api('comment?type=list&status=approved&page=1&pageSize=100', { token: adminToken })).data.data.length === before.data.data.length, await importNotice.textContent().catch(() => 'none'));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.screenshot({ path: `${OUT}/migration-error-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  chooser = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: /^import$/iu }).click();
  await importSheet.locator('.act-import-confirm').click();
  await (await chooser).setFiles(file);
  const t0 = Date.now();
  while (!/success|fail/iu.test((await importNotice.textContent().catch(() => '')) ?? '') && Date.now() - t0 < 30000) await sleep(200);
  await sleep(500);
  const after = await api('comment?type=list&status=approved&page=1&pageSize=100', { token: adminToken });
  const spam = await api('comment?type=list&status=spam&page=1&pageSize=100', { token: adminToken });
  const bText = before.data.data.map((c) => c.orig).sort().join('|');
  const aText = after.data.data.map((c) => c.orig).sort().join('|');
  check(5, 'import round-trips comments', /success/iu.test(await importNotice.textContent().catch(() => '')) && bText === aText && after.data.data.length === before.data.data.length && spam.data.data.length === 7, `notice=${await importNotice.textContent().catch(() => '')} before=${before.data.data.length} after=${after.data.data.length}`);
  check(5, 'import success is an inline notice, no dialog, no reload', (await importNotice.getAttribute('class')).includes('notice-success') && !page.__dialogs.length && (await page.evaluate(() => performance.getEntriesByType('navigation').length)) === 1);
  await page.route('**/api/db?*', (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"errno":500,"errmsg":"boom"}' }) : route.continue()));
  await page.route('**/api/db', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"errno":500,"errmsg":"boom"}' }));
  await page.locator('button', { hasText: /^export$/iu }).first().click();
  await sleep(500);
  check(5, 'export failure is an inline notice, not an unhandled rejection', /export failed/iu.test(await page.locator('.migration .panel').first().locator('.notice').textContent().catch(() => '')) && !page.__console.some((e) => /Unhandled|pageerror/u.test(e)), `${await page.locator('.migration .notice').first().textContent().catch(() => 'none')} ${page.__console.join(' | ')}`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const reply = after.data.data.find((c) => c.orig === 'Thanks from the admin');
  const parent = reply && after.data.data.find((c) => c.objectId === reply.pid);
  check(5, 'import rebuilt reply relationship', Boolean(parent), reply ? `pid=${reply.pid}` : 'reply missing');
  const me = await api('token', { token: adminToken });
  check(5, 'admin still valid after import', me.data?.type === 'administrator');
  await ctx.close();
}

{
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/');
  await openAccount(page);
  const focused = await page.evaluate(() => document.activeElement?.closest('.sheet') !== null);
  await page.keyboard.press('Escape');
  await page.locator('.sheet-root').waitFor({ state: 'detached' });
  const restored = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  check(6, 'account sheet: focus moves in, Escape closes, focus returns', focused && restored === 'Account', `${focused} ${restored}`);
  await openAccount(page);
  await page.getByRole('radio', { name: 'Dark' }).click();
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  await settle(page);
  const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(6, 'theme toggle persists across reload', t1 === 'dark' && t2 === 'dark', `${t1} ${t2} bg=${bg}`);
  await openAccount(page);
  check(6, 'theme picker shows Dark selected', (await page.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')) === 'true');
  await page.getByRole('radio', { name: 'System' }).click();
  check(6, 'toggle back to system clears override', (await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('line-theme')])).every((v) => v == null));
  await ctx.close();
  const dctx = await ctxFor({ scheme: 'dark' });
  const dp = await open(dctx, '/');
  const dbg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = dbg.match(/\d+/gu).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
  check(6, 'prefers-color-scheme dark respected', lum < 80, dbg);
  await dctx.close();
}

const pagesLoggedOut = ['/', '/login', '/forgot', '/nope'];
const pagesAdmin = ['/', '/?view=posts', `/thread?path=${encodeURIComponent('/posts/convo/')}`, '/profile', '/user', '/migration'];
const pagesGuest = ['/profile'];
const overflow = [];
for (const width of [320, 360, 390, 414, 768, 1280]) {
  for (const scheme of ['light', 'dark']) {
    for (const [who, token, list] of [['out', null, pagesLoggedOut], ['admin', adminToken, pagesAdmin], ['guest', guestToken, pagesGuest]]) {
      const ctx = await ctxFor({ token, width, scheme });
      const page = await open(ctx);
      for (const p of list) {
        await page.goto(BASE + p);
        await settle(page);
        if (p === '/' && who === 'admin') await page.waitForFunction(() => !document.querySelector('.comment-list.is-loading')).catch(() => {});
        if (p.startsWith('/thread')) await page.waitForSelector('.bubble-row').catch(() => {});
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
          return { sw: doc.scrollWidth, cw: doc.clientWidth, wide };
        });
        if (m.sw > m.cw) overflow.push(`${who} ${p} ${width} ${scheme} sw=${m.sw} cw=${m.cw} ${m.wide.join(',')}`);
        const name = `${who}${p.replace(/[?=&%]+.*$/u, (m) => (m.startsWith('?view') ? '-posts' : '')).replace(/\//gu, '-') || '-root'}-${width}-${scheme}`.replace(/-$/u, '-root');
        if (width === 360 || width === 1280 || (width === 768 && scheme === 'light')) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
}
check(6, 'no horizontal scroll at 320/360/390/414/768/1280 on every page, both themes', overflow.length === 0, overflow.join(' | '));

{
  const ctx = await ctxFor({ locale: 'vi-VN' });
  const page = await open(ctx, '/');
  check(7, 'vi-VN browser locale still English', (await h1(page)) === 'Login', await h1(page));
  await page.goto(`${BASE}/login?lng=zh-CN`);
  await settle(page);
  check(7, '?lng=zh-CN switches to Chinese', (await h1(page)) === '登录', await h1(page));
  await page.goto(`${BASE}/`);
  await settle(page);
  check(7, 'chosen language remembered', (await h1(page)) === '登录', await h1(page));
  await ctx.close();
  const actx = await ctxFor({ locale: 'vi-VN', token: adminToken });
  const ap = await open(actx, '/');
  await openAccount(ap);
  await ap.locator('.lang-select select').selectOption('vi');
  await sleep(300);
  check(7, 'language picker switches to Vietnamese', (await h1(ap)) === 'Quản lý bình luận', await h1(ap));
  await ap.locator('.lang-select select').selectOption('en-US');
  await actx.close();
}

{
  const PASSWORD = 'New-pass-22';
  const notice = (page) => page.locator('.notice').textContent().catch(() => '');
  const stored = (page) => page.evaluate(() => ({ session: sessionStorage.getItem('TOKEN'), local: localStorage.getItem('TOKEN') }));
  const tokenPosts = (page) => {
    const list = [];
    page.on('request', (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/token' && list.push(r.url()));
    return list;
  };
  const fillLogin = async (page, email, password) => {
    await page.fill('input[name=email]', email);
    await page.fill('input[name=password]', password);
  };

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/login');
    const attrs = await page.evaluate(() => ['email', 'password'].map((n) => document.querySelector(`input[name=${n}]`).getAttribute('autocomplete')));
    check(10, 'login inputs are autofill-friendly', attrs[0].split(' ')[0] === 'username' && attrs[1] === 'current-password' && (await page.locator('input[name=email]').getAttribute('type')) === 'email', attrs.join(','));
    const posts = tokenPosts(page);
    await fillLogin(page, ADMIN.email, 'Wrong-pass-1');
    await page.click('form[name=login] button[type=submit]');
    await page.locator('.notice').waitFor({ timeout: 5000 }).catch(() => {});
    const text = await notice(page);
    check(10, 'wrong password shows a clear error and stays on /login', /wrong email or password/iu.test(text) && (await loc(page)) === '/login' && !(await stored(page)).session, text);
    check(10, 'button is usable again after a failure', !(await page.locator('form[name=login] button[type=submit]').isDisabled()));
    check(10, 'wrong password sent one request', posts.length === 1, String(posts.length));
    const bad = await open(ctx, '/login');
    await fillLogin(bad, 'not-an-email', 'x');
    await bad.click('form[name=login] button[type=submit]');
    await sleep(200);
    check(10, 'malformed email is caught before the server', /valid email/iu.test(await notice(bad)), await notice(bad));

    posts.length = 0;
    await fillLogin(page, ADMIN.email, PASSWORD);
    await page.locator('input[name=password]').press('Enter');
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForURL(`${BASE}/`, { timeout: 5000 }).catch(() => {});
    await settle(page);
    check(10, 'Enter submits; a double Enter sends one login request', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && posts.length === 1, `${await loc(page)} posts=${posts.length}`);
    check(10, 'header shows the account right after login, no reload', (await page.locator('.me-name').textContent().catch(() => '')) === 'Steve Edited' && (await page.evaluate(() => performance.getEntriesByType('navigation').length)) === 1);
    const session = await stored(page);
    check(10, 'session-only login keeps the token out of localStorage', Boolean(session.session) && !session.local, JSON.stringify(session));
    await page.reload();
    await settle(page);
    check(10, 'session-only login survives a reload of the tab', (await h1(page)) === 'Comments');
    const other = await open(ctx, '/');
    check(10, 'session-only login is not shared with a new tab', (await h1(other)) === 'Login', await h1(other));
    await other.close();
    await logout(page);
    const after = await stored(page);
    check(10, 'logout clears the token and the header at once', !after.session && !after.local && (await page.locator('.me').count()) === 0 && (await h1(page)) === 'Login', JSON.stringify(after));
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/login');
    await fillLogin(page, ADMIN.email, PASSWORD);
    await page.check('input[name=remember]');
    await page.click('form[name=login] button[type=submit]');
    await page.waitForURL(`${BASE}/`, { timeout: 5000 }).catch(() => {});
    await settle(page);
    const saved = await stored(page);
    check(10, 'remember me stores the token in localStorage', Boolean(saved.local) && saved.local === saved.session, JSON.stringify(saved));
    const other = await open(ctx, '/');
    check(10, 'remembered login carries to a new tab', (await h1(other)) === 'Comments', await h1(other));
    await other.reload();
    await settle(other);
    check(10, 'remembered login survives reload', (await h1(other)) === 'Comments');
    await logout(other);
    const cleared = await stored(other);
    check(10, 'logout clears the remembered token too', !cleared.local && !cleared.session, JSON.stringify(cleared));
    const again = await open(ctx, '/');
    check(10, 'after logout a new tab is logged out', (await h1(again)) === 'Login');
    await ctx.close();
  }

  {
    const ctx = await ctxFor({ token: 'not-a-token' });
    const page = await open(ctx, '/profile');
    const navs = [];
    page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()));
    await sleep(800);
    const text = await notice(page);
    const left = await stored(page);
    check(10, 'invalid token on load: logged out cleanly with a notice, no loop', (await loc(page)) === '/login?redirect=%2Fprofile' && /session has expired/iu.test(text) && !left.session && navs.length === 0, `${await loc(page)} ${text} navs=${navs.length}`);
    await ctx.close();
    const lctx = await ctxFor({ storage: { TOKEN: 'stale' } });
    const lp = await open(lctx, '/');
    check(10, 'stale remembered token is dropped', (await h1(lp)) === 'Login' && !(await stored(lp)).local);
    await lctx.close();
  }

  {
    const ctx = await ctxFor();
    const page = await open(ctx, `/login?token=${adminToken}`);
    check(10, '?token= on /login lands signed in on / with the token stripped', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && !page.url().includes('token='), page.url());
    await page.goto(`${BASE}/profile?token=${adminToken}&x=1`);
    await settle(page);
    check(10, '?token= on another page keeps the rest of the query', (await loc(page)) === '/profile?x=1' && (await h1(page)) === 'Settings', await loc(page));
    await ctx.close();
  }

  const setup = await api('token/2fa', { token: adminToken });
  const secret = setup.data?.secret;
  const totp = (offset = 0) => speakeasy.totp({ secret, encoding: 'base32', time: Math.floor(Date.now() / 1000) + offset });
  const valid = new Set([-90, -60, -30, 0, 30, 60, 90].map(totp));
  let wrong = 0;
  while (valid.has(String(wrong).padStart(6, '0'))) wrong += 1;
  const WRONG = String(wrong).padStart(6, '0');
  const enabled = await api('token/2fa', { method: 'POST', token: adminToken, body: { code: totp(), secret } });
  const status = await api(`token/2fa?email=${encodeURIComponent(ADMIN.email)}`);
  check(10, '2FA enabled for the admin', enabled.errno === 0 && status.data?.enable === true, JSON.stringify(enabled));

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/login');
    const posts = tokenPosts(page);
    await page.evaluate(({ email, password }) => {
      const set = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[name=email]'), email);
      set(document.querySelector('input[name=password]'), password);
    }, { email: ADMIN.email, password: PASSWORD });
    await page.click('form[name=login] button[type=submit]');
    await page.locator('input[name=code]').waitFor({ timeout: 5000 }).catch(() => {});
    await sleep(300);
    const codeInput = page.locator('input[name=code]');
    const focused = await page.evaluate(() => document.activeElement?.name);
    const codeAttrs = await codeInput.evaluate((el) => ({ mode: el.getAttribute('inputmode'), ac: el.getAttribute('autocomplete'), pattern: el.getAttribute('pattern'), max: el.maxLength }));
    check(10, '2FA account: password step switches to a separate code screen, no login sent yet', (await codeInput.count()) === 1 && (await page.locator('form[name=login]').count()) === 0 && (await page.locator('input[name=password]').count()) === 0 && posts.length === 0, `posts=${posts.length}`);
    check(10, 'code screen: heading and URL change, email shown', (await h1(page)) === 'Two-step verification' && (await loc(page)) === '/login?step=verify' && (await page.locator('.auth-account-email').textContent()) === ADMIN.email && /6-digit code/iu.test(await page.locator('.auth-lede').textContent()), `${await h1(page)} ${await loc(page)}`);
    check(10, 'code screen: the code field has focus', focused === 'code', String(focused));
    check(10, '2FA code input is numeric one-time-code, 6 digits', codeAttrs.mode === 'numeric' && codeAttrs.ac === 'one-time-code' && codeAttrs.pattern === '\\d{6}' && codeAttrs.max === 6, JSON.stringify(codeAttrs));
    check(10, 'code screen keeps a hidden username for password managers', (await page.locator('form[name=verify] input[autocomplete=username]').inputValue()) === ADMIN.email);
    await page.click('form[name=verify] button[type=submit]');
    await sleep(300);
    check(10, '2FA: empty code is refused without a request', posts.length === 0 && /verification code/iu.test(await notice(page)), await notice(page));
    await codeInput.fill('123');
    await codeInput.press('Enter');
    await sleep(300);
    check(10, '2FA: a short code is refused without a request', posts.length === 0 && /6 digits/iu.test(await notice(page)), await notice(page));
    await codeInput.fill('');
    await codeInput.pressSequentially(WRONG, { delay: 30 });
    await page.locator('.notice').filter({ hasText: /didn't work/u }).waitFor({ timeout: 5000 }).catch(() => {});
    await sleep(300);
    check(10, '2FA: six digits submit on their own; a wrong code shows an inline error', posts.length === 1 && /verification code didn't work/iu.test(await notice(page)) && (await loc(page)) === '/login?step=verify' && !(await stored(page)).session, `${posts.length} ${await notice(page)}`);
    check(10, '2FA: after a wrong code the field is cleared and focused again', (await codeInput.inputValue()) === '' && (await page.evaluate(() => document.activeElement?.name)) === 'code' && (await codeInput.getAttribute('aria-invalid')) === 'true');
    await page.keyboard.press('Escape');
    await page.locator('form[name=login]').waitFor({ timeout: 3000 }).catch(() => {});
    await sleep(200);
    check(10, 'Escape returns to the password step with the email kept and the password cleared', (await h1(page)) === 'Login' && (await loc(page)) === '/login' && (await page.inputValue('input[name=email]')) === ADMIN.email && (await page.inputValue('input[name=password]')) === '' && (await page.evaluate(() => document.activeElement?.name)) === 'password', `${await h1(page)} ${await loc(page)}`);
    check(10, 'the error from the code screen does not follow back', (await page.locator('.notice').count()) === 0);
    await page.fill('input[name=password]', PASSWORD);
    await page.click('form[name=login] button[type=submit]');
    await codeInput.waitFor({ timeout: 5000 }).catch(() => {});
    await page.goBack();
    await page.locator('form[name=login]').waitFor({ timeout: 3000 }).catch(() => {});
    await sleep(200);
    check(10, 'browser Back returns to the password step with the email kept and the password cleared', (await h1(page)) === 'Login' && (await loc(page)) === '/login' && (await page.inputValue('input[name=email]')) === ADMIN.email && (await page.inputValue('input[name=password]')) === '', `${await h1(page)} ${await loc(page)}`);
    await page.goForward();
    await sleep(400);
    check(10, 'browser Forward to the code screen without a password in memory falls back to step 1', (await h1(page)) === 'Login' && (await loc(page)) === '/login', `${await h1(page)} ${await loc(page)}`);
    await page.fill('input[name=password]', PASSWORD);
    await page.click('form[name=login] button[type=submit]');
    await codeInput.waitFor({ timeout: 5000 }).catch(() => {});
    await page.locator('.act-other-account').click();
    await page.locator('form[name=login]').waitFor({ timeout: 3000 }).catch(() => {});
    await sleep(200);
    check(10, '"Use a different account" returns to step 1 with the email field focused', (await h1(page)) === 'Login' && (await loc(page)) === '/login' && (await page.inputValue('input[name=email]')) === ADMIN.email && (await page.evaluate(() => document.activeElement?.name)) === 'email');
    await page.fill('input[name=password]', PASSWORD);
    await page.click('form[name=login] button[type=submit]');
    await codeInput.waitFor({ timeout: 5000 }).catch(() => {});
    await page.reload();
    await settle(page);
    check(10, 'reloading the code screen starts over at step 1 (the password is not stored)', (await h1(page)) === 'Login' && (await loc(page)) === '/login' && !(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).includes(PASSWORD), `${await h1(page)} ${await loc(page)}`);
    await fillLogin(page, ADMIN.email, PASSWORD);
    await page.click('form[name=login] button[type=submit]');
    await codeInput.waitFor({ timeout: 5000 }).catch(() => {});
    const code = totp();
    const sent = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/token', { timeout: 5000 }).catch(() => null);
    await codeInput.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, ` ${code.slice(0, 3)} ${code.slice(3)} `);
    const body = (await sent)?.postDataJSON() ?? {};
    await page.waitForURL(`${BASE}/`, { timeout: 5000 }).catch(() => {});
    await settle(page);
    check(10, '2FA: pasting the code with spaces submits it and logs in', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && posts.length === 2, `${await loc(page)} posts=${posts.length}`);
    check(10, 'the sign-in request carries email, password and the stripped code', body.email === ADMIN.email && body.password === PASSWORD && body.code === code, JSON.stringify({ ...body, password: body.password ? '…' : body.password }));
    check(10, 'the password is not kept in storage after login', !(await page.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).includes(PASSWORD));
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/');
    await fillLogin(page, ADMIN.email, PASSWORD);
    await page.check('input[name=remember]');
    await page.click('form[name=login] button[type=submit]');
    await page.locator('input[name=code]').waitFor({ timeout: 5000 }).catch(() => {});
    check(10, 'from / the code screen is /?step=verify', (await loc(page)) === '/?step=verify' && (await h1(page)) === 'Two-step verification', await loc(page));
    await page.route('**/api/token?*', async (route) => {
      if (route.request().method() === 'POST') await sleep(1500);
      await route.continue();
    });
    await page.locator('input[name=code]').fill(totp());
    await sleep(300);
    const verifyBtn = page.locator('form[name=verify] button[type=submit]');
    check(10, 'code screen shows a loading state while verifying', (await verifyBtn.isDisabled()) && /verifying/iu.test(await verifyBtn.textContent()) && (await page.locator('input[name=code]').getAttribute('readonly')) !== null, await verifyBtn.textContent());
    for (const [width, scheme] of [[390, 'light'], [390, 'dark']]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${OUT}/login-step2-loading-${width}-${scheme}.png` });
    }
    await page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Comments', null, { timeout: 5000 }).catch(() => {});
    const saved = await stored(page);
    check(10, 'from /: the code signs in, the step leaves the URL, remember me applies', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && Boolean(saved.local) && saved.local === saved.session, `${await loc(page)} ${JSON.stringify(saved).slice(0, 40)}`);
    await ctx.close();
  }

  {
    const shotsDir = process.env.LOGIN_SHOTS;
    if (shotsDir) {
      fs.mkdirSync(shotsDir, { recursive: true });
      const sizes = [['iphone13', 390, 844], ['w320', 320, 640], ['desktop', 1280, 800]];
      for (const scheme of ['light', 'dark']) {
        for (const [name, width, height] of sizes) {
          const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, hasTouch: width < 720, deviceScaleFactor: width < 720 ? 2 : 1 });
          ctx.on('page', watchDialogs);
          const page = await ctx.newPage();
          await page.goto(`${BASE}/login`);
          await settle(page);
          await page.screenshot({ path: `${shotsDir}/step1-${name}-${scheme}.png` });
          await fillLogin(page, ADMIN.email, PASSWORD);
          await page.click('form[name=login] button[type=submit]');
          await page.locator('input[name=code]').waitFor({ timeout: 5000 }).catch(() => {});
          await sleep(200);
          await page.screenshot({ path: `${shotsDir}/step2-empty-${name}-${scheme}.png` });
          await page.locator('input[name=code]').fill(WRONG);
          await page.locator('.notice').waitFor({ timeout: 5000 }).catch(() => {});
          await sleep(200);
          await page.screenshot({ path: `${shotsDir}/step2-error-${name}-${scheme}.png` });
          await page.route('**/api/token?*', async (route) => {
            if (route.request().method() === 'POST') await sleep(2500);
            await route.continue().catch(() => {});
          });
          await page.locator('input[name=code]').fill(WRONG);
          await sleep(300);
          await page.screenshot({ path: `${shotsDir}/step2-loading-${name}-${scheme}.png` });
          await ctx.close();
        }
      }
    }
  }

  {
    const ctx = await ctxFor();
    const blog = await ctx.newPage();
    await blog.goto('https://stevehoang.com/posts/x');
    await blog.evaluate(() => {
      window.__messages = [];
      addEventListener('message', (e) => window.__messages.push({ origin: e.origin, data: e.data }));
    });
    const [popup] = await Promise.all([ctx.waitForEvent('page'), blog.evaluate((url) => window.open(url, 'login'), `${BASE}/login`)]);
    await settle(popup);
    await fillLogin(popup, ADMIN.email, PASSWORD);
    await popup.click('form[name=login] button[type=submit]');
    await popup.locator('input[name=code]').waitFor({ timeout: 5000 }).catch(() => {});
    await popup.locator('input[name=code]').pressSequentially(totp(), { delay: 20 });
    await sleep(1200);
    const messages = await blog.evaluate(() => window.__messages);
    const info = messages.find((m) => m.data?.type === 'userInfo');
    check(10, 'blog popup: opener gets userInfo with the token from the admin origin', info && info.origin === new URL(BASE).origin && typeof info.data.data.token === 'string' && info.data.data.email === ADMIN.email, JSON.stringify(messages).slice(0, 200));
    check(10, 'blog popup: the 2FA secret and password never reach the blog', info && !('2fa' in info.data.data) && !('password' in info.data.data), info ? Object.keys(info.data.data).join(',') : 'none');
    await ctx.close();
  }

  const off = await api('user', { method: 'PUT', token: adminToken, body: { '2fa': '' } });
  const offStatus = await api(`token/2fa?email=${encodeURIComponent(ADMIN.email)}`);
  check(10, '2FA turned off again', off.errno === 0 && offStatus.data?.enable === false);

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/forgot');
    await page.fill('input[name=email]', 'nobody@example.com');
    await page.click('form[name=forgot] button[type=submit]');
    await page.locator('.notice').waitFor({ timeout: 5000 }).catch(() => {});
    check(10, 'forgot password without mail service reports the failure', /reset password email/iu.test(await notice(page)) && (await loc(page)) === '/forgot', await notice(page));
    check(10, 'no page errors in the login flows', !page.__console.filter((e) => !e.startsWith('Failed to load resource')).length, page.__console.join(' | '));
    await ctx.close();
  }
}

{
  const PASSWORD = 'New-pass-22';
  const notice = (page) => page.locator('.notice').textContent().catch(() => '');
  const stored = (page) => page.evaluate(() => ({ session: sessionStorage.getItem('TOKEN'), local: localStorage.getItem('TOKEN') }));
  const setPasskeys = (value) => fetch(`${BASE}/__passkeys`, { method: 'POST', body: value });
  const noAutofill = (ctx) => ctx.addInitScript(() => {
    if (window.PublicKeyCredential) window.PublicKeyCredential.isConditionalMediationAvailable = async () => false;
  });
  const authenticator = async (page, { verified = true, credential } = {}) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: verified, automaticPresenceSimulation: true },
    });
    if (credential) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential });
    return { cdp, authenticatorId };
  };
  const passkeyPosts = (page) => {
    const list = [];
    page.on('request', (r) => r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/passkey') && list.push(new URL(r.url()).pathname));
    return list;
  };
  const shots = (name) => `${OUT}/passkey-${name}.png`;
  const me = (await api('token', { token: adminToken })).data;

  await setPasskeys('');
  {
    const ctx = await ctxFor();
    await noAutofill(ctx);
    const page = await open(ctx, '/login');
    check(11, 'no PASSKEYS: the passkey button still shows wherever WebAuthn works, email joins passkey autofill', (await page.locator('.btn-passkey').count()) === 1 && (await page.locator('input[name=email]').getAttribute('autocomplete')) === 'username webauthn' && (await page.evaluate(() => window.PASSKEY_ENABLED)) === false);
    await page.locator('.btn-passkey').click();
    await page.locator('.notice').waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'no PASSKEYS: pressing it says passkeys are not set up, inline', /aren't set up on this server/iu.test(await notice(page)) && (await loc(page)) === '/login' && !(await page.locator('.btn-passkey').isDisabled()), await notice(page));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: shots('login-not-configured-390-light') });
    await ctx.close();
  }
  {
    const ctx = await ctxFor();
    await ctx.addInitScript(() => {
      delete window.PublicKeyCredential;
    });
    const page = await open(ctx, '/login');
    check(11, 'without WebAuthn there is no passkey button and plain username autofill', (await page.locator('.btn-passkey').count()) === 0 && (await page.locator('input[name=email]').getAttribute('autocomplete')) === 'username' && (await page.locator('form[name=login] button[type=submit]').getAttribute('class')).includes('btn-primary'));
    await ctx.close();
  }
  {
    const iphone = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
    iphone.on('page', watchDialogs);
    await noAutofill(iphone);
    const page = await iphone.newPage();
    await page.goto(`${BASE}/login`);
    await settle(page);
    check(11, 'passkey button renders with an iPhone Safari user agent and viewport', (await page.locator('.btn-passkey').isVisible()) && (await page.locator('.btn-passkey').boundingBox()).height >= 44);
    await iphone.close();
  }

  const unauth = await fetch(`${BASE}/api/passkey`);
  const guestList = await fetch(`${BASE}/api/passkey`, { headers: { authorization: `Bearer ${guestToken}` } });
  const guestReg = await fetch(`${BASE}/api/passkey/register/options`, { method: 'POST', headers: { authorization: `Bearer ${guestToken}` } });
  const noConfig = await fetch(`${BASE}/api/passkey/login/options`, { method: 'POST' });
  check(11, 'passkey API: listing and registration need the administrator', unauth.status === 401 && guestList.status === 403 && guestReg.status === 403, `${unauth.status} ${guestList.status} ${guestReg.status}`);
  check(11, 'passkey API: sign-in options say not configured without PASSKEYS', noConfig.status === 404 && (await noConfig.json()).errno === 'passkey_not_configured', String(noConfig.status));

  let credential = null;
  {
    const ctx = await ctxFor({ token: adminToken });
    const page = await open(ctx);
    const { cdp, authenticatorId } = await authenticator(page);
    await page.goto(`${BASE}/profile`);
    await settle(page);
    const section = page.locator('#passkeys');
    await section.locator('.muted').first().waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'profile shows a Passkeys section with none configured', (await section.count()) === 1 && /no passkeys/iu.test(await section.textContent()), (await section.textContent().catch(() => '')).slice(0, 120));
    check(11, 'the Passkeys section has no copy-JSON or Vercel steps', !/Vercel|redeploy|Environment Variables/iu.test(await section.textContent()) && (await section.locator('textarea').count()) === 0);
    await page.fill('input[name=passkeyName]', 'E2E key');
    await section.getByRole('button', { name: 'Add passkey' }).click();
    await section.locator('.passkey-status').waitFor({ timeout: 10000 }).catch(() => {});
    const status = await section.locator('.passkey-status').textContent().catch(() => '');
    const items = await section.locator('.passkey-item-name').allTextContents();
    check(11, 'Add passkey saves it: success inline and the list updates at once', /E2E key.*added.*sign in with it right away/iu.test(status) && items.join(',') === 'E2E key' && (await section.locator('.passkey-item.fresh').count()) === 1 && /Not used yet/u.test(await section.locator('.passkey-item-meta').first().textContent()), `${items.join(',')} ${status}`);
    check(11, 'no Vercel steps after adding either, and the name field is cleared', !/Vercel|redeploy|PASSKEYS/u.test(await section.textContent()) && (await page.inputValue('input[name=passkeyName]')) === '');
    await page.setViewportSize({ width: 390, height: 800 });
    await section.screenshot({ path: shots('profile-added-390-light') });
    await page.setViewportSize({ width: 1280, height: 800 });
    const listed = await api('passkey', { token: adminToken });
    check(11, 'the passkey is stored in the database straight away', listed.data?.storage === 'database' && listed.data.passkeys.length === 1 && listed.data.passkeys[0].name === 'E2E key' && listed.data.passkeys[0].source === 'app' && !('publicKey' in listed.data.passkeys[0]), JSON.stringify(listed.data ?? listed).slice(0, 160));
    ({ credentials: [credential] } = await cdp.send('WebAuthn.getCredentials', { authenticatorId }));
    check(11, 'the authenticator holds a discoverable credential for localhost', credential?.isResidentCredential === true && credential.rpId === 'localhost', JSON.stringify(credential ?? {}).slice(0, 120));

    await page.reload();
    await settle(page);
    await section.getByRole('button', { name: 'Add passkey' }).click();
    await section.locator('.passkey-exists').waitFor({ timeout: 10000 }).catch(() => {});
    const exists = await section.locator('.passkey-exists').textContent().catch(() => '');
    check(11, 'adding the same device again explains it already has a passkey you can sign in with', /already has a passkey here.*you can sign in with it/iu.test(exists) && /remove its old passkey/iu.test(exists) && (await section.locator('.passkey-error').count()) === 0 && (await section.locator('.passkey-item').count()) === 1, exists || (await section.textContent()));
    await section.screenshot({ path: shots('profile-duplicate-1280-light') });
    check(11, 'no page errors on the profile passkey flow', !page.__console.filter((e) => !e.startsWith('Failed to load resource')).length, page.__console.join(' | '));
    await ctx.close();
  }

  const setup = await api('token/2fa', { token: adminToken });
  const secret = setup.data?.secret;
  const totp = () => speakeasy.totp({ secret, encoding: 'base32' });
  const enabled = await api('token/2fa', { method: 'POST', token: adminToken, body: { code: totp(), secret } });
  check(11, '2FA on again for the passkey sign-in', enabled.errno === 0);

  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/login');
    const button = page.locator('.btn-passkey');
    check(11, 'with a stored passkey (no PASSKEYS, no restart) the login page offers a passkey button above the form', (await button.count()) === 1 && (await page.evaluate(() => window.PASSKEY_ENABLED)) === true && (await page.evaluate(() => document.querySelector('.btn-passkey').compareDocumentPosition(document.querySelector('form[name=login]')) & Node.DOCUMENT_POSITION_FOLLOWING)) > 0 && (await button.textContent()).includes('Sign in with a passkey'));
    check(11, 'the email field joins passkey autofill', (await page.locator('input[name=email]').getAttribute('autocomplete')) === 'username webauthn');
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    await noAutofill(ctx);
    const page = await open(ctx);
    await authenticator(page, { credential });
    await page.goto(`${BASE}/login`);
    await settle(page);
    const posts = passkeyPosts(page);
    const tokenLogin = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/passkey/login', { timeout: 10000 }).catch(() => null);
    await page.locator('.btn-passkey').click();
    const resp = await tokenLogin;
    await page.waitForURL(`${BASE}/`, { timeout: 10000 }).catch(() => {});
    await settle(page);
    const saved = await stored(page);
    check(11, 'the passkey added moments ago signs in straight to the manager, no TOTP asked', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && (await page.locator('input[name=code]').count()) === 0 && posts.join(',') === '/api/passkey/login/options,/api/passkey/login', `${await loc(page)} ${posts.join(',')} ${await notice(page)}`);
    check(11, 'passkey session-only login keeps the token out of localStorage', Boolean(saved.session) && !saved.local, JSON.stringify(saved));
    const who = await api('token', { token: saved.session });
    check(11, 'the passkey token is a normal Waline token for the admin', who.data?.objectId === me.objectId && who.data?.type === 'administrator');
    const listed = await api('comment?type=list&page=1', { token: saved.session });
    check(11, 'admin APIs accept the passkey token', listed.errno === 0 && Array.isArray(listed.data?.data));
    const passkeyData = resp ? (await resp.json()).data : {};
    const pwd = await api('token', { method: 'POST', body: { email: ADMIN.email, password: PASSWORD, code: totp() } });
    const keys = (o) => Object.keys(o ?? {}).sort().join(',');
    check(11, 'passkey sign-in answers exactly like POST /api/token', pwd.errno === 0 && keys(passkeyData) === keys(pwd.data) && passkeyData.password === null && passkeyData.avatar === pwd.data.avatar, `${keys(passkeyData)} vs ${keys(pwd.data)}`);
    check(11, 'the header shows the account right after passkey login', (await page.locator('.me-name').textContent().catch(() => '')) === 'Steve Edited');
    await logout(page);
    check(11, 'logout after a passkey login clears the token', !(await stored(page)).session && (await h1(page)) === 'Login');

    await page.check('input[name=remember]');
    await page.locator('.btn-passkey').click();
    await page.waitForURL(`${BASE}/`, { timeout: 10000 }).catch(() => {});
    await settle(page);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Comments', null, { timeout: 5000 }).catch(() => {});
    const remembered = await stored(page);
    check(11, 'remember me is respected by passkey login', (await h1(page)) === 'Comments' && Boolean(remembered.local) && remembered.local === remembered.session, JSON.stringify(remembered));
    await logout(page);
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    const page = await open(ctx);
    await authenticator(page, { credential });
    const posts = passkeyPosts(page);
    await page.goto(`${BASE}/login`);
    await page.waitForURL(`${BASE}/`, { timeout: 10000 }).catch(() => {});
    await settle(page);
    check(11, 'conditional UI: choosing the passkey from autofill signs in', (await loc(page)) === '/' && (await h1(page)) === 'Comments' && posts.includes('/api/passkey/login'), `${await loc(page)} ${posts.join(',')}`);
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    const blog = await ctx.newPage();
    await blog.goto('https://stevehoang.com/posts/x');
    await blog.evaluate(() => {
      window.__messages = [];
      addEventListener('message', (e) => window.__messages.push({ origin: e.origin, data: e.data }));
    });
    await noAutofill(ctx);
    const [popup] = await Promise.all([ctx.waitForEvent('page'), blog.evaluate((url) => window.open(url, 'login'), `${BASE}/login`)]);
    await authenticator(popup, { credential });
    await settle(popup);
    await popup.locator('.btn-passkey').click();
    await sleep(1500);
    const messages = await blog.evaluate(() => window.__messages);
    const info = messages.find((m) => m.data?.type === 'userInfo');
    check(11, 'blog popup: passkey login posts userInfo with the token, without the 2FA secret or password', info && info.origin === new URL(BASE).origin && typeof info.data.data.token === 'string' && info.data.data.email === ADMIN.email && !('2fa' in info.data.data) && !('password' in info.data.data), info ? Object.keys(info.data.data).join(',') : JSON.stringify(messages).slice(0, 200));
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    await noAutofill(ctx);
    const page = await open(ctx);
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await authenticator(page, {
      credential: {
        credentialId: crypto.randomBytes(16).toString('base64'),
        isResidentCredential: true,
        rpId: 'localhost',
        privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
        userHandle: Buffer.from(String(me.objectId)).toString('base64'),
        signCount: 0,
      },
    });
    await page.goto(`${BASE}/login`);
    await settle(page);
    await page.locator('.btn-passkey').click();
    await page.locator('.notice').waitFor({ timeout: 10000 }).catch(() => {});
    check(11, 'an unknown passkey fails cleanly with a clear message', /isn't set up for this site/iu.test(await notice(page)) && (await loc(page)) === '/login' && !(await stored(page)).session && !(await page.locator('.btn-passkey').isDisabled()), await notice(page));
    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({ path: shots('login-error-390-light') });
    await ctx.close();
  }

  {
    const ctx = await ctxFor();
    await noAutofill(ctx);
    const page = await open(ctx);
    await authenticator(page, { verified: false, credential });
    await page.goto(`${BASE}/login`);
    await settle(page);
    const posts = passkeyPosts(page);
    await page.locator('.btn-passkey').click();
    await page.locator('.notice').waitFor({ timeout: 10000 }).catch(() => {});
    check(11, 'a refused or cancelled prompt shows a message and sends no sign-in', /cancelled|timed out/iu.test(await notice(page)) && !posts.includes('/api/passkey/login') && (await loc(page)) === '/login', `${await notice(page)} ${posts.join(',')}`);
    await page.fill('input[name=email]', ADMIN.email);
    await page.fill('input[name=password]', PASSWORD);
    await page.click('form[name=login] button[type=submit]');
    await page.locator('input[name=code]').waitFor({ timeout: 5000 }).catch(() => {});
    await page.fill('input[name=code]', totp());
    await page.waitForURL(`${BASE}/`, { timeout: 5000 }).catch(() => {});
    await settle(page);
    check(11, 'the password + 2FA form still works next to the passkey button', (await loc(page)) === '/' && (await h1(page)) === 'Comments', await loc(page));
    await ctx.close();
  }

  const envKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const envJwk = envKey.publicKey.export({ format: 'jwk' });
  const envRawId = crypto.randomBytes(16);
  const envCose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(envJwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(envJwk.y, 'base64url'),
  ]);
  const envCredential = {
    credentialId: envRawId.toString('base64'),
    isResidentCredential: true,
    rpId: 'localhost',
    privateKey: envKey.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    userHandle: Buffer.from(String(me.objectId)).toString('base64'),
    signCount: 0,
  };
  const envId = envRawId.toString('base64url');
  const profile = async (ctx) => {
    const page = await open(ctx, '/profile');
    await page.locator('#passkeys .passkey-item, #passkeys .muted').first().waitFor({ timeout: 5000 }).catch(() => {});
    return page;
  };
  const names = (page) => page.locator('#passkeys .passkey-item-name').allTextContents();
  const passkeySignIn = async (cred) => {
    const ctx = await ctxFor();
    await noAutofill(ctx);
    const page = await open(ctx);
    await authenticator(page, { credential: cred });
    await page.goto(`${BASE}/login`);
    await settle(page);
    if (!(await page.locator('.btn-passkey').count())) {
      await ctx.close();
      return { at: '/login', heading: 'Login', notice: 'no passkey button', token: null };
    }
    await page.locator('.btn-passkey').click();
    await Promise.race([page.waitForURL(`${BASE}/`, { timeout: 10000 }), page.locator('.notice').waitFor({ timeout: 10000 })]).catch(() => {});
    await settle(page);
    const result = { at: await loc(page), heading: await h1(page), notice: await notice(page), token: (await stored(page)).session };
    await ctx.close();
    return result;
  };

  await setPasskeys(JSON.stringify([{ id: envId, publicKey: envCose.toString('base64url'), userId: String(me.objectId), name: 'Steve Hoang', transports: ['internal'], createdAt: '2026-01-15T09:30:00.000Z' }]));
  {
    const ctx = await ctxFor({ token: adminToken });
    const page = await profile(ctx);
    const section = page.locator('#passkeys');
    check(11, 'a PASSKEYS entry is imported and listed next to the stored passkey', (await names(page)).join(',') === 'E2E key,Steve Hoang' && /Added Jan 15, 2026/u.test(await section.locator('.passkey-item-meta').nth(1).textContent()), (await names(page)).join(','));
    check(11, 'the section says PASSKEYS in Vercel is no longer needed', /PASSKEYS in Vercel is no longer needed.*delete the variable/iu.test(await section.locator('.passkey-hint').textContent().catch(() => '')), await section.locator('.passkey-hint').textContent().catch(() => ''));
    await ctx.close();
  }
  const imported = await passkeySignIn(envCredential);
  check(11, 'the imported PASSKEYS entry signs in', imported.at === '/' && imported.heading === 'Comments' && Boolean(imported.token), JSON.stringify(imported));

  {
    const overflow = [];
    for (const scheme of ['light', 'dark']) {
      for (const width of [320, 390, 1280]) {
        const ctx = await ctxFor({ width, scheme });
        await noAutofill(ctx);
        const page = await open(ctx, '/login');
        await page.locator('.btn-passkey').waitFor({ timeout: 5000 }).catch(() => {});
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (sw > 0) overflow.push(`login ${width} ${scheme}`);
        if (width !== 320) await page.screenshot({ path: shots(`login-${width}-${scheme}`), fullPage: true });
        await ctx.close();
        const actx = await ctxFor({ width, scheme, token: adminToken });
        const ap = await profile(actx);
        const asw = await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (asw > 0) overflow.push(`profile ${width} ${scheme}`);
        const small = await ap.evaluate(() => [...document.querySelectorAll('#passkeys button')].filter((b) => b.getBoundingClientRect().height < (innerWidth < 720 ? 44 : 40)).map((b) => b.textContent));
        if (small.length) overflow.push(`small targets ${width} ${scheme}: ${small.join(',')}`);
        if (width !== 320) await ap.locator('#passkeys').screenshot({ path: shots(`profile-${width}-${scheme}`) });
        await ap.locator('#passkeys .passkey-remove').last().click();
        await ap.locator('#passkeys .passkey-confirm').waitFor({ timeout: 5000 }).catch(() => {});
        const csw = await ap.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (csw > 0) overflow.push(`confirm ${width} ${scheme}`);
        if (width !== 320) await ap.locator('#passkeys').screenshot({ path: shots(`profile-confirm-${width}-${scheme}`) });
        await actx.close();
      }
    }
    check(11, 'passkey button and Passkeys section (2 passkeys, and the remove confirm) fit at 320/390/1280 in both themes with 44px targets on phones', overflow.length === 0, overflow.join(' | '));
  }

  {
    const ctx = await ctxFor({ token: adminToken, width: 390 });
    const page = await profile(ctx);
    const section = page.locator('#passkeys');
    check(11, 'the imported passkey shows when it was last used', /Last used/u.test(await section.locator('.passkey-item-meta').nth(1).textContent()), await section.locator('.passkey-item-meta').nth(1).textContent());
    const item = section.locator('.passkey-item').first();
    await item.getByRole('button', { name: 'Remove E2E key' }).click();
    const confirmBox = item.locator('.passkey-confirm[role=alertdialog]');
    await confirmBox.waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'Remove asks in the page, focused on the confirm button', (await confirmBox.count()) === 1 && /Remove “E2E key”\?/u.test(await confirmBox.textContent()) && (await page.evaluate(() => document.activeElement?.classList.contains('act-passkey-remove'))) && !page.__dialogs.length, await confirmBox.textContent().catch(() => ''));
    await confirmBox.getByRole('button', { name: 'Cancel' }).click();
    check(11, 'Cancel keeps the passkey and returns focus to its Remove button', (await section.locator('.passkey-confirm').count()) === 0 && (await names(page)).length === 2 && (await page.evaluate(() => document.activeElement?.classList.contains('passkey-remove'))));
    await item.getByRole('button', { name: 'Remove E2E key' }).click();
    await page.keyboard.press('Escape');
    check(11, 'Escape closes the confirm too', (await section.locator('.passkey-confirm').count()) === 0);
    await item.getByRole('button', { name: 'Remove E2E key' }).click();
    await section.locator('.act-passkey-remove').click();
    await section.locator('.passkey-status').waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'removing a passkey updates the list at once', (await names(page)).join(',') === 'Steve Hoang' && /“E2E key” is removed/u.test(await section.locator('.passkey-status').textContent()) && !page.__dialogs.length, `${(await names(page)).join(',')} ${await section.locator('.passkey-status').textContent().catch(() => '')}`);
    await ctx.close();
  }
  const removedLogin = await passkeySignIn(credential);
  check(11, 'a removed passkey no longer signs in, with a clear message', removedLogin.at === '/login' && !removedLogin.token && /isn't set up for this site/iu.test(removedLogin.notice), JSON.stringify(removedLogin));

  {
    const ctx = await ctxFor({ token: adminToken });
    const page = await open(ctx);
    await authenticator(page, { credential });
    await page.goto(`${BASE}/profile`);
    await settle(page);
    const section = page.locator('#passkeys');
    await page.fill('input[name=passkeyName]', 'E2E again');
    await section.getByRole('button', { name: 'Add passkey' }).click();
    await section.locator('.passkey-status').waitFor({ timeout: 10000 }).catch(() => {});
    check(11, 'once its old passkey is removed, the same device can add a new one', (await names(page)).join(',') === 'Steve Hoang,E2E again' && (await section.locator('.passkey-exists').count()) === 0, `${(await names(page)).join(',')} ${await section.textContent()}`);
    await section.locator('.passkey-item').last().getByRole('button', { name: 'Remove E2E again' }).click();
    await section.locator('.act-passkey-remove').click();
    await section.locator('.passkey-item').nth(1).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});

    await section.locator('.passkey-item').first().getByRole('button', { name: 'Remove Steve Hoang' }).click();
    check(11, 'the confirm for an imported passkey says it will not be imported again', /won't be imported again/u.test(await section.locator('.passkey-confirm').textContent().catch(() => '')));
    await section.locator('.act-passkey-remove').click();
    await section.locator('.muted', { hasText: 'No passkeys' }).waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'removing the imported PASSKEYS entry works and says it stays removed', (await names(page)).length === 0 && /stays removed even though PASSKEYS/u.test(await section.locator('.passkey-status').textContent().catch(() => '')), await section.textContent());
    await page.reload();
    await settle(page);
    await section.locator('.muted').first().waitFor({ timeout: 5000 }).catch(() => {});
    check(11, 'after a reload the removed PASSKEYS entry is not imported again', (await names(page)).length === 0 && /no passkeys/iu.test(await section.textContent()));
    check(11, 'no native dialogs or page errors while removing passkeys', !page.__dialogs.length && !page.__console.filter((e) => !e.startsWith('Failed to load resource')).length, [...page.__dialogs, ...page.__console].join(' | '));
    await ctx.close();
  }
  const removedEnv = await passkeySignIn(envCredential);
  check(11, 'the removed PASSKEYS entry no longer signs in either', removedEnv.at === '/login' && !removedEnv.token && Boolean(removedEnv.notice), JSON.stringify(removedEnv));
  const emptyOptions = await fetch(`${BASE}/api/passkey/login/options`, { method: 'POST' });
  check(11, 'with every passkey removed, sign-in options say not configured', emptyOptions.status === 404 && (await emptyOptions.json()).errno === 'passkey_not_configured', String(emptyOptions.status));

  const off = await api('user', { method: 'PUT', token: adminToken, body: { '2fa': '' } });
  check(11, '2FA turned off after the passkey checks', off.errno === 0);
  {
    const ctx = await ctxFor();
    const page = await open(ctx, '/login');
    check(11, 'with every passkey removed the shell reports none and the button stays', (await page.locator('.btn-passkey').count()) === 1 && (await page.evaluate(() => window.PASSKEY_ENABLED)) === false);
    await ctx.close();
  }
  await setPasskeys('');
}

{
  const ctx = await ctxFor({ width: 390, token: adminToken });
  await ctx.route(`${BASE}/api/passkey?*`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ errno: 0, errmsg: '', data: { enabled: true, storage: 'env', notice: { errno: 'passkey_storage_error', message: 'The passkey table wl_Passkeys could not be created: CREATE command denied' }, status: 'ok', rpID: 'localhost', passkeys: [{ id: 'EnV', name: 'Old key', createdAt: '2026-01-15T00:00:00Z', lastUsedAt: '', transports: [], source: 'env', inEnv: true, mine: true }] } }),
  }));
  const page = await open(ctx, '/profile');
  const section = page.locator('#passkeys');
  const text = await section.textContent();
  check(11, 'storage unavailable: Passkeys says why and is read-only, with no Add and no Remove', /can't save passkeys in its database/iu.test(text) && /CREATE command denied/u.test(text) && /Old key/u.test(text) && (await section.locator('.act-passkey-add').count()) === 0 && (await section.locator('.passkey-remove').count()) === 0, text.slice(0, 200));
  await ctx.close();
}

{
  const ip = '198.51.100.77';
  const attempt = (password) => fetch(`${BASE}/api/token`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ email: GUEST.email, password }) });
  for (let i = 0; i < 10; i += 1) await attempt('wrong-password');
  const blocked = await attempt(GUEST.password);
  check(12, 'password sign-in: 10 failures from one IP answer 429, even for the right password', blocked.status === 429 && (await blocked.json()).errno === 429 && Number(blocked.headers.get('retry-after')) > 0, String(blocked.status));
  const ctx = await ctxFor({ width: 390 });
  await ctx.setExtraHTTPHeaders({ 'x-real-ip': ip });
  const page = await open(ctx, '/login');
  await page.fill('input[name=email]', GUEST.email);
  await page.fill('input[name=password]', GUEST.password);
  await page.click('form[name=login] button[type=submit]');
  await page.locator('.notice').waitFor({ timeout: 5000 }).catch(() => {});
  check(12, 'the login page says to wait a few minutes, inline, and stays on /login', /too many attempts/iu.test(await page.locator('.notice').textContent().catch(() => '')) && (await loc(page)) === '/login');
  await ctx.close();
}

check(12, 'no native alert/confirm/prompt dialog fired anywhere in the run', dialogs.length === 0, dialogs.slice(0, 5).join(' | '));
check(8, 'no CSP violations across the whole run', cspViolations.length === 0, [...new Set(cspViolations)].slice(0, 5).join(' | '));
await browser.close();
fs.writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
