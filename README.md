# line.stevehoang.com

The [Waline](https://waline.js.org/) comment server for
[stevehoang.com](https://stevehoang.com), deployed on Vercel at
<https://line.stevehoang.com>.

It is the stock `@waline/vercel` server (pinned in `package.json`) behind a
small wrapper that serves our own fork of the Waline admin at the site root,
instead of upstream's demo page at `/` and the unpkg-hosted admin at `/ui`.

## Routes

| Path | Method | Served by |
| --- | --- | --- |
| `/`, `/login`, `/register`, `/forgot`, `/profile`, `/user`, `/migration`, `/thread` (trailing slash and any query allowed) | GET, HEAD | Admin HTML shell (`lib/ui.cjs`). This shadows Waline's deprecated un-prefixed `GET /user` API; `/api/user` is unaffected |
| `/admin.js` | GET, HEAD | `admin/dist/admin.js`; immutable when `?v=` matches its hash, 5 minutes otherwise, ETag/304; 503 if it is not built |
| `/ui`, `/ui/*` | GET, HEAD | 301 to the same path without `/ui`, query kept, repeated slashes collapsed so `/ui//evil.com` stays on this host. Keeps Waline's own emails and redirects (`/ui/login`, `/ui/profile?token=…`) working |
| any path containing a `..` segment | any | 404 |
| `/api/oauth`, `/oauth` (and their `/index`, `.html` forms) with a `redirect` whose origin is not this server, `SITE_URL` or `ALLOWED_ORIGINS` | any | 400. Waline would send the login token to whatever `redirect` names |
| `/robots.txt` | any | static file |
| everything else (`/api/*`, POST to any path, …) | any | Waline, untouched |

`index.cjs` is the Vercel function: it asks `lib/ui.cjs` first and hands the
request to Waline when the router declines it.

The shell sets `window.SITE_URL`, `SITE_NAME`, `recaptchaV3Key`,
`turnstileKey`, `oauthServices`, `ALLOWED_ORIGINS` and `serverURL`
(`SERVER_URL` when set, otherwise built from
`x-forwarded-proto`/`x-forwarded-host`/`host`; then `/api/`), and loads
`/admin.js?v=<hash>` as a module. It is sent with a Content-Security-Policy:
the inline globals carry a per-request nonce, scripts otherwise come from this
origin and the reCAPTCHA/Turnstile hosts, and `frame-ancestors 'none'`. There
is deliberately no `Cross-Origin-Opener-Policy`, since the blog's login popup
reads the token back through `window.opener`. The OAuth service list is fetched from
`OAUTH_URL` with a 2-second timeout and cached for 10 minutes; if it fails the
page is still served with an empty list (retried after a minute).

## Conversations

`/?view=posts` lists one row per post: the admin list (`type=list`, no status
filter, 100 a page) is read for its newest 1,000 comments and grouped by `url`,
so a site with more says it is showing the latest 1,000. `/thread?path=<url>`
(`&focus=<id>` to scroll to one comment) reads the post through Waline's
public `GET /api/comment?path=`, which returns every status to an
administrator, 100 top-level comments a page with their replies, and pages
until it has them all. Both are kept in memory for the session, shown at once
on a return visit and refreshed behind it.

## Environment

Waline's own variables (`LEAN_*`, `JWT_TOKEN`, SMTP, `SECURE_DOMAINS`, …) are
unchanged; see the [Waline docs](https://waline.js.org/en/reference/server/env.html).
The shell also reads:

| Variable | Default | Use |
| --- | --- | --- |
| `SITE_URL` | `https://stevehoang.com` | The blog the admin links back to |
| `SITE_NAME` | `Steve Hoang` | `window.SITE_NAME`; the page title is `Comments · <SITE_NAME>` unless the name already starts with "Comments". Waline uses it in its emails |
| `SERVER_URL` | request origin | Public URL of this server; `window.serverURL` is `<SERVER_URL>/api/`. Waline reads it too |
| `ALLOWED_ORIGINS` | unset | Comma-separated `https://host` origins trusted like `SITE_URL` (token hand-off, post-login return, OAuth `redirect`) |
| `OAUTH_URL` | `https://oauth.lithub.cc` | Social login service list (Waline uses it too) |
| `RECAPTCHA_V3_KEY`, `TURNSTILE_KEY` | unset | Site keys for the login form |

See `.env.example`.

## Rebuilding the admin

The admin lives in `admin/` (forked from `@waline/admin`) and builds to a single
ES module, `admin/dist/admin.js`. Vercel does not build it: the built file is
committed and shipped with the function through `includeFiles` in
`vercel.json`.

```sh
npm run build:admin
git add admin/dist
```

The shell's `?v=` hash changes with the file's contents, so a new bundle is
picked up on the next deploy without cache trouble.

## Tests

```sh
npm install
npm test
```

`test/ui.test.cjs` runs the router against a stub Waline handler and a
temporary bundle, so it needs neither the database nor a built admin.

`test/e2e/admin.e2e.mjs` drives the built admin in Chromium against a fresh
local server (below): `rm -rf .local && COMMENT_AUDIT=true IPQPS=0 npm run start:local`,
then `npm run test:e2e` (Playwright must be importable: `npm i --no-save playwright`,
or `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs`). Screenshots go to `E2E_OUT`
(default `$TMPDIR/wcs-e2e`).

## Running locally

`test/serve-local.cjs` wraps `index.cjs` in a plain HTTP server with SQLite
storage in `.local/` and a stub OAuth list. It needs Waline's empty SQLite
database once, from the Waline repository's `assets/waline.sqlite`:

```sh
curl -Lo /tmp/waline.sqlite https://raw.githubusercontent.com/walinejs/waline/main/assets/waline.sqlite
WALINE_SQLITE_SCHEMA=/tmp/waline.sqlite npm run start:local
```

Then <http://localhost:8360/> is the admin and
`curl 'http://localhost:8360/api/comment?path=/x'` the API. The first account
registered becomes the administrator. `PORT`, `SQLITE_PATH` and `JWT_TOKEN`
override the defaults; delete `.local/` to start over.

## Deploying

Push to the branch Vercel deploys. `vercel.json` keeps the legacy `builds`:
`robots.txt` as a static file and `index.cjs` as the Node function, with
every other path rewritten to it. Commit `admin/dist` whenever `admin/`
changes, or `/admin.js` answers 503.
