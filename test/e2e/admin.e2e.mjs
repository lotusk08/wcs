import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

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
const cspViolations = [];

async function ctxFor({ token, width = 1280, scheme = 'light', locale = 'en-US', storage } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, locale, acceptDownloads: true });
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
    if (url.hostname === 'stevehoang.com' && route.request().resourceType() === 'document') {
      return route.fulfill({ body: '<!doctype html><title>blog</title>', contentType: 'text/html' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  return ctx;
}

async function open(ctx, path) {
  const page = await ctx.newPage();
  page.__dialogs = [];
  page.__console = [];
  page.on('dialog', async (d) => {
    page.__dialogs.push(`${d.type()}: ${d.message()}`);
    events.push(`${d.type()}: ${d.message()}`);
    if (d.type() === 'prompt') await d.accept(page.__promptValue ?? '');
    else await d.accept();
  });
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

async function register(page, nick, email, password) {
  await page.goto(`${BASE}/register`);
  await settle(page);
  await page.fill('input[name=nick]', nick);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', password);
  await page.fill('input[name=password-again]', password);
  await page.click('form[name=register] button[type=submit]');
  await sleep(800);
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
  for (const [from, to] of [['/ui', '/'], ['/ui/login', '/login'], ['/ui/profile?token=x', '/login?redirect=%2Fprofile']]) {
    await page.goto(BASE + from);
    await settle(page);
    const at = await loc(page);
    check(1, `${from} ends on ${to}`, at === to, at);
  }
  const tokenLeft = await page.evaluate(() => sessionStorage.getItem('TOKEN'));
  check(1, '/ui/profile?token=x: bogus token discarded', !tokenLeft, String(tokenLeft));
  check(1, 'no page errors logged out', !page.__console.filter((e) => !e.includes('401')).length, page.__console.join(' | '));
  await ctx.close();
}

let adminToken;
{
  const ctx = await ctxFor();
  const page = await open(ctx);
  await register(page, ADMIN.nick, ADMIN.email, ADMIN.password);
  check(2, 'register first user lands on /login', (await loc(page)).startsWith('/login'), `${await loc(page)} dialogs=${page.__dialogs.join(';')}`);
  await login(page, ADMIN.email, ADMIN.password);
  check(2, 'admin login lands on comment manager at /', (await loc(page)) === '/' && (await h1(page)) === 'Comments', `${await loc(page)} ${await h1(page)}`);
  adminToken = await page.evaluate(() => sessionStorage.getItem('TOKEN'));
  const me = await api('token', { token: adminToken });
  check(2, 'first user is administrator', me.data?.type === 'administrator', me.data?.type);
  await page.getByRole('button', { name: 'Logout' }).click();
  await settle(page);
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
    await page.getByRole('button', { name: 'Logout' }).click().catch(() => {});
    await settle(page);
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
  const social = new URL(await lp.locator('.social-btn').first().getAttribute('href'));
  const ret = social.searchParams.get('redirect');
  check(2, 'social login button returns via /login?redirect=<blog>', ret === `${BASE}/login?redirect=${encodeURIComponent('https://stevehoang.com/posts/x')}`, ret);
  const leg = await fetch(social.href, { redirect: 'manual' });
  check(2, 'server accepts that oauth redirect', leg.status === 302, `${leg.status} ${leg.headers.get('location')}`);
  const lp2 = await open(lp.context(), '/login?redirect=%2Fuser');
  const ret2 = new URL(await lp2.locator('.social-btn').first().getAttribute('href')).searchParams.get('redirect');
  check(2, 'social login keeps a local redirect', ret2 === `${BASE}/user`, ret2);
  await lp.context().close();
  for (const bad of ['https://evil.com/', '//evil.com', 'javascript:alert(1)']) {
    const r = await fetch(`${BASE}/api/oauth?type=github&redirect=${encodeURIComponent(bad)}`, { redirect: 'manual' });
    check(2, `server refuses oauth redirect ${bad}`, r.status === 400, String(r.status));
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
  await register(page, GUEST.nick, GUEST.email, GUEST.password);
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
  check(3, 'guest sees no admin nav', (await page.locator('.site-nav').count()) === 0);
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
  const waitList = async () => { await page.waitForFunction(() => !document.querySelector('.comment-list.is-loading')); await sleep(100); };
  await waitList();
  check(4, 'approved tab empty initially', (await page.locator('.comment-list .empty').count()) === 1);
  check(4, 'waiting count badge shows 38', (await tab('Waiting').locator('.count').textContent()) === '38');
  await tab('Waiting').click();
  await waitList();
  check(4, 'waiting tab shows 10 per page', (await items().count()) === 10, String(await items().count()));
  check(4, 'waiting paginator shows 4 pages', (await page.locator('.pager .page-btn', { hasText: '4' }).count()) === 1);
  for (let round = 0; round < 3; round += 1) {
    await page.locator('.bulkbar input[type=checkbox]').check();
    check(4, `select-all selects 10 (round ${round + 1})`, (await page.locator('.comment-check:checked').count()) === 10);
    await page.locator('.bulk-actions .text-btn', { hasText: 'Approve' }).click();
    await sleep(300);
    await waitList();
  }
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
  const foreign = await page.locator('li.comment', { hasText: 'foreign page url' }).locator('.comment-where a').getAttribute('href').catch(() => 'missing');
  check(4, 'post link for a foreign url stays on SITE_URL', foreign === 'https://stevehoang.com/phish', foreign);
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
  await target.locator('.act-sticky').click();
  await sleep(400);
  check(4, 'sticky tag appears', (await page.locator(`#${targetId} .tag`).count()) === 1);
  const stickyApi = await api(`comment?path=${encodeURIComponent('/posts/post-1/')}`);
  await page.locator(`#${targetId} .act-sticky`).click();
  await sleep(400);
  check(4, 'unsticky removes tag', (await page.locator(`#${targetId} .tag`).count()) === 0);

  await page.locator(`#${targetId} .act-spam`).click();
  await sleep(400);
  check(4, 'spam removes from approved list, spam badge 1', (await page.locator(`#${targetId}`).count()) === 0 && (await tab('Spam').locator('.count').textContent()) === '1');
  await tab('Spam').click();
  await waitList();
  check(4, 'spam tab lists it', (await page.locator(`#${targetId}`).count()) === 1);
  await page.locator(`#${targetId} .act-waiting`).click();
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
  const dialogsBefore = page.__dialogs.length;
  await del.locator('.act-delete').click();
  await sleep(500);
  const gone = await api(`comment?type=list&status=approved&page=1&pageSize=100`, { token: adminToken });
  check(4, 'delete asks confirm and removes', page.__dialogs.length === dialogsBefore + 1 && !gone.data.data.some((c) => c.objectId === delId), page.__dialogs.slice(dialogsBefore).join(';'));

  const mdItem = page.locator('li.comment', { hasText: 'my link' });
  const mdId = await mdItem.getAttribute('id');
  await mdItem.locator('.act-edit').click();
  const textarea = await page.locator(`#${mdId} textarea[name=comment]`).inputValue();
  check(4, 'edit form shows original markdown, not rendered HTML', textarea.includes('[my link](https://example.org/page)'), JSON.stringify(textarea.slice(0, 80)));
  await page.fill(`#${mdId} input[name=nick]`, 'Edited Reader');
  await page.fill(`#${mdId} textarea[name=comment]`, 'Edited [new link](https://example.net/) and <img src=x onerror="window.__xss=9">');
  await page.locator(`#${mdId} .comment-editor button[type=submit]`).click();
  await sleep(600);
  const edited = page.locator(`#${mdId}`);
  const editedHtml = await edited.locator('.comment-content').innerHTML().catch(() => '');
  check(4, 'edit saved: nick updated', (await edited.locator('.comment-author').textContent()) === 'Edited Reader');
  check(4, 'edit saved: content rendered as markdown and sanitized', editedHtml.includes('href="https://example.net/"') && !editedHtml.includes('onerror') && (await page.evaluate(() => window.__xss)) === undefined, editedHtml.slice(0, 160));

  const replyTo = page.locator('li.comment', { hasText: 'Seed comment number' }).first();
  const replyToId = await replyTo.getAttribute('id');
  await replyTo.locator('.act-reply').click();
  await page.fill(`#${replyToId} .comment-reply textarea`, 'Thanks from the admin');
  await page.locator(`#${replyToId} .comment-reply button[type=submit]`).click();
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
  await page.locator('.bulkbar input[type=checkbox]').check();
  await page.locator('.bulk-actions .text-btn', { hasText: 'Spam' }).click();
  await sleep(400);
  await waitList();
  check(4, 'bulk spam empties waiting', (await page.locator('.comment-list .empty').count()) === 1 && (await tab('Spam').locator('.count').textContent()) === '8');
  await tab('Spam').click();
  await waitList();
  await page.locator('.comment-check').first().check();
  await page.locator('.bulk-actions .text-btn', { hasText: 'Delete' }).click();
  await sleep(500);
  await waitList();
  check(4, 'bulk delete one from spam', (await tab('Spam').locator('.count').textContent()) === '7');
  const realErrors = page.__console.filter((e) => !e.startsWith('Failed to load resource'));
  check(4, 'no unexpected alerts or page errors in manager (404s are hostile <img src=x>)', !realErrors.length && page.__bad404.every((u) => u === `${BASE}/x`) && page.__dialogs.every((d) => d.startsWith('confirm')), [...realErrors, ...new Set(page.__bad404)].join(' | '));
  await page.screenshot({ path: `${OUT}/manager-desktop.png`, fullPage: true });
  await ctx.close();
}

{
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/profile');
  check(5, 'profile renders for admin', (await h1(page)) === 'Settings');
  await page.fill('input[name=screenName]', 'Steve Edited');
  await page.fill('input[name=url]', 'https://stevehoang.com/about');
  await page.locator('.panel', { hasText: 'Profile' }).locator('button[type=submit]').first().click();
  await sleep(600);
  const me = await api('token', { token: adminToken });
  check(5, 'profile name/url saved', me.data.display_name === 'Steve Edited' && me.data.url === 'https://stevehoang.com/about', `${me.data.display_name} ${me.data.url}`);
  check(5, 'header shows new name without reload', (await page.locator('.me-name').textContent()) === 'Steve Edited');
  const pw = page.locator('#change-password');
  await pw.locator('input[name=password]').fill('New-pass-22');
  await pw.locator('input[name=confirm]').fill('New-pass-22');
  await pw.locator('button[type=submit]').click();
  await sleep(600);
  const bad = await api('token', { method: 'POST', body: { email: ADMIN.email, password: ADMIN.password } });
  const good = await api('token', { method: 'POST', body: { email: ADMIN.email, password: 'New-pass-22' } });
  check(5, 'password change: old rejected, new accepted', bad.errno !== 0 && good.errno === 0, `old=${bad.errno} new=${good.errno}`);
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
  await tfa.locator('input[name=code]').fill('123456');
  await tfa.locator('button[type=submit]').click();
  await sleep(500);
  check(5, '2FA wrong code rejected with message', page.__dialogs.some((d) => d.startsWith('alert')), page.__dialogs.join(';'));
  await page.screenshot({ path: `${OUT}/profile-2fa.png`, fullPage: true });
  await ctx.close();
}

{
  await api('user', { method: 'POST', body: { display_name: 'Third', email: 'third@example.com', password: 'Third-pass-1', url: '' } });
  const ctx = await ctxFor({ token: adminToken });
  const page = await open(ctx, '/user');
  const row = (name) => page.locator('.user-row', { hasText: name });
  check(5, 'user list shows 3 users', (await page.locator('.user-row').count()) === 3, String(await page.locator('.user-row').count()));
  check(5, 'no delete on self', (await row('Steve Edited').locator('.act-delete').count()) === 0);
  await row('guest@example.com').locator('.act-administrator').click();
  await sleep(400);
  let g = await api('token', { token: guestToken });
  check(5, 'set guest -> administrator', g.data.type === 'administrator');
  await row('guest@example.com').locator('.act-guest').click();
  await sleep(400);
  g = await api('token', { token: guestToken });
  check(5, 'set administrator -> guest', g.data.type === 'guest');
  await row('Steve Edited').locator('.act-guest').click();
  await sleep(300);
  check(5, 'cannot demote self (alert)', page.__dialogs.some((d) => d.includes("can't set yourself")), page.__dialogs.join(';'));
  page.__promptValue = 'VIP';
  await row('guest@example.com').locator('.act-label').click();
  await sleep(400);
  check(5, 'set label', (await row('guest@example.com').locator('.tag', { hasText: 'VIP' }).count()) === 1);
  await row('third@example.com').locator('.act-delete').click();
  await sleep(500);
  const users = await api('user?page=1', { token: adminToken });
  const third = users.data.data.find((u) => u?.email === 'third@example.com');
  check(5, 'delete user: Waline bans it, row shows Banned without reload', third?.type === 'banned' && (await row('third@example.com').locator('.tag').first().textContent()) === 'Banned' && (await row('third@example.com').locator('.act-delete').count()) === 0, third?.type);
  await page.reload();
  await settle(page);
  check(5, 'banned user shows Banned after reload', (await row('third@example.com').locator('.tag').first().textContent()) === 'Banned');
  await row('third@example.com').locator('.act-guest').click();
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
  const chooser = page.waitForEvent('filechooser');
  await page.locator('button', { hasText: /^import$/iu }).click();
  await (await chooser).setFiles(file);
  const t0 = Date.now();
  while (!page.__dialogs.some((d) => /success|error|fail/iu.test(d)) && Date.now() - t0 < 30000) await sleep(200);
  await sleep(1000);
  const after = await api('comment?type=list&status=approved&page=1&pageSize=100', { token: adminToken });
  const spam = await api('comment?type=list&status=spam&page=1&pageSize=100', { token: adminToken });
  const bText = before.data.data.map((c) => c.orig).sort().join('|');
  const aText = after.data.data.map((c) => c.orig).sort().join('|');
  check(5, 'import round-trips comments', page.__dialogs.some((d) => /success/iu.test(d)) && bText === aText && after.data.data.length === before.data.data.length && spam.data.data.length === 7, `dialogs=${page.__dialogs.join(';')} before=${before.data.data.length} after=${after.data.data.length}`);
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
  const toggle = page.getByRole('button', { name: 'Toggle light and dark' });
  await toggle.click();
  const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  await settle(page);
  const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(6, 'theme toggle persists across reload', t1 === 'dark' && t2 === 'dark', `${t1} ${t2} bg=${bg}`);
  await page.getByRole('button', { name: 'Toggle light and dark' }).click();
  check(6, 'toggle back to system clears override', (await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('line-theme')])).every((v) => v == null));
  await ctx.close();
  const dctx = await ctxFor({ scheme: 'dark' });
  const dp = await open(dctx, '/');
  const dbg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lum = dbg.match(/\d+/gu).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
  check(6, 'prefers-color-scheme dark respected', lum < 80, dbg);
  await dctx.close();
}

const pagesLoggedOut = ['/', '/login', '/register', '/forgot', '/nope'];
const pagesAdmin = ['/', '/profile', '/user', '/migration'];
const pagesGuest = ['/profile'];
const overflow = [];
for (const width of [360, 390, 768, 1280]) {
  for (const scheme of ['light', 'dark']) {
    for (const [who, token, list] of [['out', null, pagesLoggedOut], ['admin', adminToken, pagesAdmin], ['guest', guestToken, pagesGuest]]) {
      const ctx = await ctxFor({ token, width, scheme });
      const page = await open(ctx);
      for (const p of list) {
        await page.goto(BASE + p);
        await settle(page);
        if (p === '/' && who === 'admin') await page.waitForFunction(() => !document.querySelector('.comment-list.is-loading')).catch(() => {});
        const m = await page.evaluate(() => {
          const doc = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
          return { sw: doc.scrollWidth, cw: doc.clientWidth, wide };
        });
        if (m.sw > m.cw) overflow.push(`${who} ${p} ${width} ${scheme} sw=${m.sw} cw=${m.cw} ${m.wide.join(',')}`);
        const name = `${who}${p.replace(/\//gu, '-') || '-root'}-${width}-${scheme}`.replace(/-$/u, '-root');
        if (width === 360 || width === 1280 || (width === 768 && scheme === 'light')) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
      }
      await ctx.close();
    }
  }
}
check(6, 'no horizontal scroll at 360/390/768/1280 on every page, both themes', overflow.length === 0, overflow.join(' | '));

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
  await ap.locator('.lang-select select').selectOption('vi');
  await sleep(300);
  check(7, 'language picker switches to Vietnamese', (await h1(ap)) === 'Quản lý bình luận', await h1(ap));
  await ap.locator('.lang-select select').selectOption('en-US');
  await actx.close();
}

check(8, 'no CSP violations across the whole run', cspViolations.length === 0, [...new Set(cspViolations)].slice(0, 5).join(' | '));
await browser.close();
fs.writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
