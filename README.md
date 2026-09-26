# line.stevehoang.com

The [Waline](https://waline.js.org/) comment server for
[stevehoang.com](https://stevehoang.com), deployed on Vercel at
<https://line.stevehoang.com>.

It is the stock `@waline/vercel` server (pinned in `package.json`) behind a
small wrapper that serves our own fork of the Waline admin at the site root,
instead of upstream's demo page at `/` and the unpkg-hosted admin at `/ui`.

Only the owner signs in: readers comment anonymously (the blog's widget runs
with `login: 'disable'`). The admin offers a passkey, or email and password
with two-step verification, and nothing else: social login and public sign-up
are switched off in the wrapper as well as in the admin.

Password sign-in takes two screens. The first asks for the email and password
(autofill-friendly: `username`/`current-password`). Only after it is submitted
does the admin ask `GET /api/token/2fa?email=` whether the account uses
two-step verification; if it does, it moves to `?step=verify`, a separate
screen for the 6-digit code (`one-time-code`, sent as soon as six digits are
typed or pasted). Waline checks the password and the code in the same
`POST /api/token` and answers a wrong one of either identically, so the
password is held in memory until that request and never stored; Back, Escape
or a reload return to the first screen. The **Sign in with a passkey** button
shows wherever the browser supports WebAuthn and says so inline when the
server has no passkey. Errors and confirmations are inline notices and in-app
sheets: the admin never opens a browser `alert`, `confirm` or `prompt`.

## Routes

| Path | Method | Served by |
| --- | --- | --- |
| `/`, `/login`, `/forgot`, `/profile`, `/user`, `/migration`, `/thread` (trailing slash and any query allowed) | GET, HEAD | Admin HTML shell (`lib/ui.cjs`). This shadows Waline's deprecated un-prefixed `GET /user` API; `/api/user` is unaffected |
| `/register` | GET, HEAD | 302 to `/login`, query kept. There is no sign-up page |
| `/admin.js` | GET, HEAD | `admin/dist/admin.js`; immutable when `?v=` matches its hash, 5 minutes otherwise, ETag/304; 503 if it is not built |
| `/ui`, `/ui/*` | GET, HEAD | 301 to the same path without `/ui`, query kept, repeated slashes collapsed so `/ui//evil.com` stays on this host. Keeps Waline's own emails and redirects (`/ui/login`, `/ui/profile?token=…`) working |
| any path containing a `..` segment | any | 404 |
| any path Waline would route to its `oauth` controller (`/api/oauth`, `/oauth`, `/api/oauth/github`, `.html` forms, doubled slashes, any case) | any | 404. Social login is off, whatever the `type` or `redirect` |
| any path Waline would route to its `user` controller (`/api/user`, `/user`, `/api/user/<id>`, …) | POST | 403 `{"errno":403,"errmsg":"Registration is closed."}` unless `ALLOW_REGISTER=true`. POST is Waline's sign-up; `PUT` (profile, role, label), `DELETE` (ban) and `GET` pass, as does `/api/user/password` (forgot password) |
| `/api/passkey` | GET | The stored passkeys, without their keys (`lib/passkey.cjs`). Administrator token required |
| `/api/passkey/register/options`, `/api/passkey/register` | POST | Passkey registration, saved to the database. Administrator token required. See [Passkeys](#passkeys) |
| `/api/passkey/<credential id>` | DELETE, PATCH | Remove a passkey, or rename it (`{"name"}`). Administrator token required; 404 for an unknown id |
| `/api/passkey/login/options`, `/api/passkey/login` | POST | Passkey sign-in. Public, rate limited per IP |
| any path Waline would route to its `token` controller (`/api/token`, …) | POST | Waline's password sign-in, watched: after 10 failed attempts from one IP in 15 minutes it answers 429 `{"errno":429}` with `Retry-After` until the window ends, without asking Waline. A successful sign-in clears the count. `/api/token/2fa` is not counted |
| `/robots.txt` | any | static file |
| everything else (`/api/*`, POST to any path, …) | any | Waline, untouched |

`index.cjs` is the Vercel function: it asks `lib/ui.cjs` first, then
`lib/passkey.cjs`, and hands the request to Waline when both decline it.

The shell sets `window.SITE_URL`, `SITE_NAME`, `recaptchaV3Key`,
`turnstileKey`, `oauthServices` (always `[]`), `ALLOWED_ORIGINS`,
`PASSKEY_ENABLED` and
`serverURL` (`SERVER_URL` when set, otherwise built from
`x-forwarded-proto`/`x-forwarded-host`/`host`; then `/api/`), and loads
`/admin.js?v=<hash>` as a module. It is sent with a Content-Security-Policy:
the inline globals carry a per-request nonce, scripts otherwise come from this
origin and the reCAPTCHA/Turnstile hosts, and `frame-ancestors 'none'`. There
is deliberately no `Cross-Origin-Opener-Policy`, since the blog's login popup
reads the token back through `window.opener`.

`PASSKEY_ENABLED` is informational: true when the passkey table held a passkey
at this instance's last read (at most 30 seconds old; reading it never delays
the page) or, before the first read, when `PASSKEYS` holds an entry not yet
imported. The admin does not use it: the passkey button shows wherever the
browser supports WebAuthn. Rendering the shell also starts that read in the
background, so the passkey table is created on the first visit.

Waline asks `OAUTH_URL` for its list of social login services on every API
request. `index.cjs` sets `OAUTH_URL` to an empty `data:` URL before Waline
loads, so that call never leaves the function and no request depends on the
third-party service; the shell does not fetch the list at all.

## Passkeys

The owner can sign in with a passkey (Face ID, Touch ID, Windows Hello, a phone
or a security key) instead of email, password and code. The passkey is
discoverable and user-verified, so signing in is one tap with nothing typed:
the login page shows **Sign in with a passkey** above the email form wherever
the browser supports WebAuthn, and the email field also offers the passkey in
the browser's autofill. Until a passkey is added, pressing the button says
inline that passkeys aren't set up on this server. A passkey
sign-in does **not** ask for the two-step verification code: a passkey with
user verification is already two factors (the device, and the fingerprint,
face or PIN that unlocks it). Password sign-in is unchanged and still asks for
the code.

Passkeys are kept in Waline's own database, in a table `<prefix>Passkeys`
(`wl_Passkeys` by default) next to `wl_Users`, created on first use. To add
one, sign in with email, password and code, open **Profile** (Settings), under
**Passkeys** optionally name it (e.g. "iPhone"), press **Add passkey** and
approve the prompt. It works at once: no environment variable, no redeploy. Each
passkey is listed with when it was added and last used, and **Remove** (asked
in the page) takes it off at once, on every instance.

If the device already holds one of the listed passkeys, the browser refuses to
make a second one and the page says so: sign in with the existing one, or
remove it first and add it again.

`lib/passkey-store.cjs` holds the table. It uses Waline's own model
(`think.model('Passkeys')`), so the connection, TLS and table prefix are exactly
Waline's (`TIDB_*`, `MYSQL_*`, `SQLITE_*`). The table is created with
`CREATE TABLE IF NOT EXISTS` for MySQL and TiDB, and for SQLite; the credential
id is `varchar(1400)` `ascii_bin` (case-sensitive, and within the 3072-byte
index limit of InnoDB and TiDB) with a unique index, the public key `text`,
dates ISO 8601 strings. When `CREATE TABLE` is refused (no `CREATE` privilege)
but the table is there, it is used as it is. Reads are cached for 30 seconds
per instance and dropped on every write; sign-in always reads the table, so a
removed passkey stops working everywhere at once. Other Waline storage
(PostgreSQL, MongoDB, LeanCloud, …), or a table that cannot be created or read,
leaves passkeys read-only from `PASSKEYS` (retried a minute later), and the
Profile page says why. The table is only touched by `/api/passkey/*` and the
shell's background read, so a failure there never reaches password sign-in or
comments.

`PASSKEYS`, where passkeys used to be kept, is still read: any valid entry not
yet in the table is copied into it on the next read, once. After that the table
is the only record, and PASSKEYS can be deleted from Vercel (the Profile page
says so while it still lists an imported passkey). Removing a passkey keeps a
row with its key cleared (`removed_at`), so an entry still in `PASSKEYS` is not
imported again. Each entry is
`{"id", "publicKey", "userId", "name", "transports", "createdAt"}`; one that is
not valid is skipped.

How it works (`lib/passkey.cjs`, [`@simplewebauthn/server`](https://simplewebauthn.dev)):

- The relying party is the host the request came in on
  (`x-forwarded-host`/`host`), so `line.stevehoang.com` in production and
  `localhost` locally; `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` override it. A
  passkey is bound to that host: one made on `line.stevehoang.com` does not
  work on a `*.vercel.app` preview, and changing the domain means adding the
  passkeys again.
- Challenges are stateless. The options come with a challenge token, HMAC
  signed with a key derived from Waline's `jwtKey`, naming its purpose
  (register or sign in, and for registration the administrator) and expiring
  after 5 minutes; the verify call sends it back. Each instance also remembers
  the challenges it has accepted, so a token is not taken twice.
- Registration needs an administrator's Waline token. Sign-in looks the
  credential up by id, checks origin, relying party, user verification and
  signature (signature counters are not enforced, since synced passkeys
  report 0), records the time as `last_used_at`, and loads the user, who must exist, not be banned and be the
  administrator. The answer is exactly what `POST /api/token` returns,
  including a normal Waline token (`jwt.sign(objectId, jwtKey)`), so every
  admin API accepts it, "Remember me" applies and the blog's login popup gets
  the same message.
- The two public calls are rate limited per IP in memory: 30 option requests
  and 10 sign-in attempts a minute.

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

Waline's own variables (the storage, `TIDB_*` in production; `JWT_TOKEN`,
SMTP, `SECURE_DOMAINS`, …) are unchanged; see the [Waline docs](https://waline.js.org/en/reference/server/env.html).
The shell also reads:

| Variable | Default | Use |
| --- | --- | --- |
| `SITE_URL` | `https://stevehoang.com` | The blog the admin links back to |
| `SITE_NAME` | `Steve Hoang` | `window.SITE_NAME`; the page title is `Comments · <SITE_NAME>` unless the name already starts with "Comments". Waline uses it in its emails |
| `SERVER_URL` | request origin | Public URL of this server; `window.serverURL` is `<SERVER_URL>/api/`. Waline reads it too |
| `ALLOWED_ORIGINS` | unset | Comma-separated `https://host` origins trusted like `SITE_URL` (token hand-off, post-login return) |
| `ALLOW_REGISTER` | unset | `true` reopens Waline's sign-up (`POST /api/user`) for an emergency, such as recreating the owner's account on an empty database: set it, redeploy, `POST /api/user` with `display_name`, `email`, `password`, then remove it and redeploy. The first account created on an empty database becomes the administrator. There is no sign-up page; use curl |
| `RECAPTCHA_V3_KEY`, `TURNSTILE_KEY` | unset | Site keys for the login form |
| `PASSKEYS` | unset | Legacy JSON array of passkeys, imported into the passkey table once and then no longer needed; delete it. See [Passkeys](#passkeys) |
| `PASSKEY_RP_ID` | request host | The WebAuthn relying party id (a domain, no scheme or port). Set `line.stevehoang.com` to pin it |
| `PASSKEY_ORIGIN` | request origin | The origin passkey ceremonies must come from, e.g. `https://line.stevehoang.com`. Its host is the relying party id when `PASSKEY_RP_ID` is unset |

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
`test/passkey.test.cjs` runs the passkey table on SQLite files (through
Waline's own `think-model-sqlite`), checks the MySQL/TiDB DDL as text, and runs
the passkey routes against stub users and a software authenticator (a P-256 key
pair from `node:crypto`), registering, signing in and removing for real.

`test/e2e/admin.e2e.mjs` drives the built admin in Chromium against a fresh
local server (below): `rm -rf .local && COMMENT_AUDIT=true IPQPS=0 npm run start:local`,
then `npm run test:e2e` (`BASE` names another server, default `http://localhost:8360`; Playwright must be importable: `npm i --no-save playwright`,
or `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs`). Screenshots go to `E2E_OUT`
(default `$TMPDIR/wcs-e2e`). The passkey checks use Chromium's virtual
authenticator; only the `PASSKEYS` import check sets it, through the local
server's `/__passkeys`.

## Running locally

`test/serve-local.cjs` wraps `index.cjs` in a plain HTTP server with SQLite
storage in `.local/`. It needs Waline's empty SQLite
database once, from the Waline repository's `assets/waline.sqlite`:

```sh
curl -Lo /tmp/waline.sqlite https://raw.githubusercontent.com/walinejs/waline/main/assets/waline.sqlite
WALINE_SQLITE_SCHEMA=/tmp/waline.sqlite npm run start:local
```

Then <http://localhost:8360/> is the admin and
`curl 'http://localhost:8360/api/comment?path=/x'` the API. Sign-up is closed
here too; the local server alone answers `POST /__register` as if
`ALLOW_REGISTER` were on, which is how the e2e run creates its accounts:

```sh
curl -X POST localhost:8360/__register -H 'content-type: application/json' \
  -d '{"display_name":"Steve","email":"admin@example.com","password":"Admin-pass-1"}'
```

The first account becomes the administrator. `POST /__passkeys` with a
`PASSKEYS` value as the body sets that variable in the running server (an
empty body removes it), to try the import of legacy entries.
Passkeys work on `http://localhost`. `PORT`, `SQLITE_PATH` and
`JWT_TOKEN` override the defaults; delete `.local/` to start over.

## Deploying

Push to the branch Vercel deploys. `vercel.json` keeps the legacy `builds`:
`robots.txt` as a static file and `index.cjs` as the Node function, with
every other path rewritten to it. Commit `admin/dist` whenever `admin/`
changes, or `/admin.js` answers 503.
