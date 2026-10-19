# line.stevehoang.com

The [Waline](https://waline.js.org/) comment server for
[stevehoang.com](https://stevehoang.com), deployed on Vercel at
<https://line.stevehoang.com>.

It is the stock `@waline/vercel` server (pinned in `package.json`) behind a
small wrapper that serves our own fork of the Waline admin at the site root in
place of the unpkg-hosted admin at `/ui`. Upstream's demo page ("Waline
Example", which loads an unpinned `@waline/client` from unpkg) is not served
anywhere: `GET /` is the admin, and every other path or method that would
reach it (`/api`, `/index`, `/api/index`, `POST /`, …) is a 404. The blog
draws its comments with its own components (`src/components/Comment*.vue` in
`lotusk08/stevehoang.com`), which call `/api/comment` as Waline's client did.

Only the owner signs in: readers comment anonymously (the blog's comments have
no sign-in). The admin offers a passkey, or email and password
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
| `/`, `/login`, `/forgot`, `/profile`, `/migration`, `/thread` (trailing slash and any query allowed) | GET, HEAD | Admin HTML shell (`lib/ui.cjs`) |
| `/register` | GET, HEAD | 302 to `/login`, query kept. There is no sign-up page |
| `/admin.js` | GET, HEAD | `admin/dist/admin.js`; immutable when `?v=` matches its hash, 5 minutes otherwise, ETag/304; 503 if it is not built |
| `/ui`, `/ui/*` | GET, HEAD | 301 to the same path without `/ui`, query kept, repeated slashes collapsed so `/ui//evil.com` stays on this host. Keeps Waline's own emails and redirects (`/ui/login`, `/ui/profile?token=…`) working |
| `/ui`, `/ui/*` | any other | 405 with `Allow: GET, HEAD`. Waline's dashboard middleware answers every method on every path starting `/ui` with a page that loads the unpinned `@waline/admin` from unpkg on this origin; it is never reached |
| any other path starting `/ui` (`/uix`, `/ui.html`, …) | any | 404, for the same reason |
| any path containing a `..` segment | any | 404 |
| any path Waline would route to its `oauth` controller (`/api/oauth`, `/oauth`, `/api/oauth/github`, `.html` forms, doubled slashes, any case) | any | 404. Social login is off, whatever the `type` or `redirect` |
| its `article` controller (`/api/article`: page views and reactions) | any | 404 `{"errno":404,"errmsg":"Page views and reactions are disabled."}`. The blog's comments ask for neither; the rows already stored stay |
| `/api/comment/rss` | any | 404. There is no comment feed |
| `/api/comment?type=count`, `?type=recent` | GET (and `POST ?method=get`) | 401 `Sign in first.` unless the request carries a token this server signed (a Bearer `Authorization`, or `?state=`); an `Authorization` header alone, `junk` or a token signed with another key, is not enough. Nobody public calls them; the admin sends its Bearer token. `GET /api/comment?path=…` (the blog's comments), `?type=list` (the admin) and `POST`/`PUT`/`DELETE /api/comment` pass |
| its `user` controller (`/api/user`, `/user`, `/api/user/<id>`, …) | POST | 403 `{"errno":403,"errmsg":"Registration is closed."}` unless `ALLOW_REGISTER=true`: POST is Waline's sign-up |
| its `user` controller | GET, HEAD | 404 `The user list is disabled.`, with or without a token: the list answered every column (password hashes and 2FA secrets included) to an administrator and the top commenters to anyone. This includes the un-prefixed `/user`, which is no longer an admin page |
| its `user` controller | DELETE, and PUT with an id in the path or `?id=` that is not the signed-in user's | 403 `Only your own account can be changed.` (no banning, no editing another account's role or label). `PUT /api/user` (the owner's own profile, password, avatar and turning 2FA off) and `PUT /api/user/password` (forgot password) pass |
| its `verification` controller (`/api/verification`) | any | 403 `Registration is closed.` unless `ALLOW_REGISTER=true` |
| its `db` controller (`/api/db`) | anything but GET, HEAD, OPTIONS | 403. Export (`GET`) stays; import used `POST`, `PUT` and `DELETE` here (it emptied each table first) |
| `/api/passkey` | GET | The stored passkeys, without their keys (`lib/passkey.cjs`). Administrator token required |
| `/api/passkey/register/options`, `/api/passkey/register` | POST | Passkey registration, saved to the database. Administrator token required. See [Passkeys](#passkeys) |
| `/api/passkey/<credential id>` | DELETE, PATCH | Remove a passkey, or rename it (`{"name"}`). Administrator token required; 404 for an unknown id |
| `/api/passkey/login/options`, `/api/passkey/login` | POST | Passkey sign-in. Public, rate limited per IP |
| any path Waline would route to its `token` controller (`/api/token`, …) | POST | Waline's password sign-in, watched: after 10 failed attempts from one IP in 15 minutes it answers 429 `{"errno":429}` with `Retry-After` until the window ends, without asking Waline. A successful sign-in clears the count. `/api/token/2fa` is not counted, nor is a `POST ?method=…` that Waline turns into another action (so it cannot clear the count either) |
| any path Waline would route to its `index` controller, or to no controller (`/`, `/api`, `/api/`, `/index`, `/api/index`, `/api/rest`, …), apart from the shell's `GET /` | any | 404 `Not found.` That is Waline's demo page |
| a request target that is not a path (`GET http://other.host/api/user`, `OPTIONS *`) | any | 400. Waline reads such a target as a path of its own, which none of the checks here would see |
| a path whose last segment, decoded, is longer than 16 characters and not a user id (letters and digits, with commas between), apart from `/api/passkey/*` | any | 404. Waline tests that segment with a backtracking pattern: 40 letters and a `!` held the instance for minutes |
| `/robots.txt` | any | static file |
| everything else (`/api/*`, …) | any | Waline, untouched |

"Would route to" means both the way Waline routes the request (the raw path,
case-sensitive: `PUT /api/user/Password` reaches the `user` controller with
the id `Password`, and `POST /api/token/2FA` is a sign-in) and a case-folded,
decoded reading of it, so a spelling Waline answers is never missed. The
action is the method, or for a `POST` the `?method=` Waline lets it name.

`index.cjs` is the Vercel function: it asks `lib/ui.cjs` first, then
`lib/passkey.cjs`, and hands the request to Waline when both decline it.

The shell sets `window.SITE_URL`, `SITE_NAME`, `recaptchaV3Key`,
`turnstileKey`, `serverURL` (this request's own origin, from
`x-forwarded-proto`/`x-forwarded-host`/`host`, then `/api/`) and
`AVATAR_PROXY`, and loads `/admin.js?v=<hash>` as a module. It is sent with a
Content-Security-Policy: the inline globals carry a per-request nonce, scripts
otherwise come from this origin and the reCAPTCHA/Turnstile hosts, `connect-src`
is this origin and those hosts, and `frame-ancestors 'none'`. It is also sent
with `Cross-Origin-Opener-Policy: same-origin`, so a page that opens the admin
in a window gets no handle on it. The blog's old login popup read the token
back through `window.opener`; the blog's comments have had no sign-in since,
and the admin hands its token to no other site (see [Removed](#removed)).

The admin takes a `?token=` from the address once, on load, and strips it:
Waline's reset-password mail links to `/ui/profile?token=…`, which lands on
`/profile?token=…`.

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
Profile page says why. The table is only touched by `/api/passkey/*`, so a
failure there never reaches password sign-in or comments.

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
  `localhost` locally; `PASSKEY_RP_ID` and `PASSKEY_ORIGIN` override it (see
  [Settings](#settings)). A
  passkey is bound to that host: one made on `line.stevehoang.com` does not
  work on a `*.vercel.app` preview, and changing the domain means adding the
  passkeys again.
- Challenges are stateless. The options come with a challenge token, HMAC
  signed with a key derived from Waline's `jwtKey`, naming its purpose
  (register or sign in, and for registration the administrator) and expiring
  after 5 minutes; the verify call sends it back. Each instance also remembers
  the challenges it has accepted, so a token is not taken twice. The key is
  `HMAC(jwtKey, 'line-passkey-challenge')`; the label was
  `waline-passkey-challenge` until 81f7d00, so a challenge issued in the five
  minutes before that deploy failed once, with "try again".
- Registration needs an administrator's Waline token. Sign-in looks the
  credential up by id, checks origin, relying party, user verification and
  signature (signature counters are not enforced, since synced passkeys
  report 0), records the time as `last_used_at`, and loads the user, who must exist, not be banned and be the
  administrator. The answer is exactly what `POST /api/token` returns,
  including a normal Waline token (`jwt.sign(objectId, jwtKey)`), so every
  admin API accepts it and "Remember me" applies.
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

## Comments

Every new comment waits for the owner's approval: `COMMENT_AUDIT` is `true` in
`index.cjs`, so a reader's comment is saved as `waiting` and shows on the blog
once it is approved in the admin. The owner's own comments are approved at once
(Waline's rule for an administrator). The spam checks are Waline's and run as
before: Akismet, a duplicate of the same comment, one comment per `IPQPS`
seconds from one IP, and `FORBIDDEN_WORDS`.

Comments are Markdown with HTML (sanitised by DOMPurify) and Prism code
highlighting. TeX (MathJax), emoji shortcodes (`:smile:`), `~sub~` and
`^sup^` are off (`MARKDOWN_TEX`, `MARKDOWN_EMOJI`, `MARKDOWN_SUB`,
`MARKDOWN_SUP` are `false` in `index.cjs`), so `$…$`, `:…:`, `~…~` and `^…^`
stay as they were typed. Waline loads MathJax only through a dynamic
`import()` that TeX off never reaches, so its font and `mhchemparser` are no
longer shipped (`includeFiles` in `vercel.json`). Each comment keeps its
Browser and OS labels; the region is shown to the administrator only.

## Avatars

`lib/avatar.cjs` is Waline's `avatarUrl`. A guest is a comment with no
`user_id`, which is every reader's: it gets the cat,
`https://stevehoang.com/assets/img/cat.webp`, directly, and no libravatar,
Gravatar or QQ request is made for a reader. A comment with a `user_id` is a
registered account's: the owner's, or, from before sign-up was closed, another
account's, which keeps that account's own avatar the same way. Such a comment
shows the avatar set in Profile; without one, Waline's libravatar address for
the email, with the cat as its fallback (`d=`), or `GRAVATAR_STR` when set.
`AVATAR_PROXY` wraps every avatar Waline answers, the cat included, and the
admin wraps any it draws that is not wrapped yet. The admin falls back to the
cat, then to a plain circle, when an image fails.

## Settings

What has one right value is fixed in `index.cjs`, set before Waline loads, so
the Vercel dashboard no longer matters for it:

| Variable | Value | Why |
| --- | --- | --- |
| `SITE_URL` | `https://stevehoang.com` | The blog. The admin links back to it; Waline uses it in its mails and for Akismet |
| `SECURE_DOMAINS` | `stevehoang.com,line.stevehoang.com` | Waline answers its API only to requests whose `Referer` (or, without one, `Origin`) is one of these hosts, `localhost` or `127.0.0.1`; anything else, a request carrying neither included, gets 403. A `*.vercel.app` preview's admin is refused too. Waline adds `localhost` and `127.0.0.1` to its list on every request, so on a warm instance the list grew by two each time; `index.cjs` hands it a fresh copy of the two hosts before each request |
| `OAUTH_URL` | an empty `data:` URL | Waline asks it for its social login services on every API request; this way that call never leaves the function |
| `COMMENT_AUDIT` | `true` | New comments wait for approval |
| `DISABLE_REGION` | `true` | The public sees no region (it was `vercel.json`'s `env`) |
| `MARKDOWN_TEX`, `MARKDOWN_EMOJI`, `MARKDOWN_SUB`, `MARKDOWN_SUP` | `false` | See [Comments](#comments) |
| `SERVER_URL` | `https://line.stevehoang.com` in production (`VERCEL_ENV=production`); removed elsewhere | The address Waline puts in the reset-password mail (`<SERVER_URL>/ui/profile?token=…`) and hands Akismet. Pinned in production, so a request's `Host` or `X-Forwarded-Host` cannot put another host, with a sign-in token in it, into that mail; a preview or a local server uses the request's own (`http://localhost:8360` locally) |
| `LOGIN`, `DISABLE_USERAGENT`, `MARKDOWN_HIGHLIGHT` | removed from the environment | Readers comment without signing in (`LOGIN=force` would refuse them); Browser/OS labels and Prism stay on |

The guest avatar is fixed in `lib/avatar.cjs` and the admin; `DEFAULT_AVATAR`
is no longer read. The Node version is `package.json`'s `engines` (`24.x`).
`vercel.json` still sets `NODE_OPTIONS=--experimental-require-module`, its
one `env`: Node 24 runs `require()` of an ES module unflagged, but Vercel's
function loader does its own `require()` and does not without the flag.
Taken out on 2026-10-17, every request failed with `ERR_REQUIRE_ESM`
(`html-encoding-sniffer` requiring `@exodus/bytes`) until production was
rolled back; a local server never shows it.

These must stay in Vercel's environment settings; never commit them:

| Variables | What |
| --- | --- |
| `TIDB_HOST`, `TIDB_PORT`, `TIDB_DB`, `TIDB_USER`, `TIDB_PASSWORD` | The database. Passkeys are kept there too. Set no other storage's variables (`LEAN_*`, `MONGO_*`, `PG_*`/`POSTGRES_*`, `SQLITE_PATH`, `MYSQL_*`, `GITHUB_TOKEN`, `TCB_*`): Waline takes the first storage it finds, and TiDB comes after most of them |
| `JWT_TOKEN` | Signs sign-in tokens and passkey challenges. Defaults to `TIDB_PASSWORD`, so rotating the password would sign everyone out |
| `SMTP_HOST` or `SMTP_SERVICE`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Mail: new-comment and reply notifications, and the reset-password link |
| `AKISMET_KEY` | Akismet (Waline falls back to a shared demo key; `false` turns it off) |
| `RECAPTCHA_V3_SECRET` or `TURNSTILE_SECRET` | Checks the login form's captcha, with its site key below |
| `WEBHOOK`, `TG_BOT_TOKEN`/`TG_CHAT_ID`, `DISCORD_WEBHOOK`, `LARK_WEBHOOK`/`LARK_SECRET`, `SC_KEY`, `QMSG_KEY`/`QQ_ID`, `QYWX_AM`, `PUSH_PLUS_KEY` | Waline's other notification channels, only if one is used |

Still read from the environment, because the right value is not known here
(tell the owner's choice and it can be fixed in code too):

| Variable | Default | Use |
| --- | --- | --- |
| `SITE_NAME` | `Steve Hoang` in the admin, `Waline` in Waline's mails | The admin's title (`Comments · <SITE_NAME>` unless it starts with "Comments"), the passkey's relying party name, and the subject and sender of Waline's mails |
| `AUTHOR_EMAIL` | unset | Where Waline mails the owner about a new comment |
| `SENDER_NAME`, `SENDER_EMAIL` | `SMTP_USER` | The mails' sender |
| `MAIL_SUBJECT`, `MAIL_TEMPLATE`, `MAIL_SUBJECT_ADMIN`, `MAIL_TEMPLATE_ADMIN` | Waline's | The reply and new-comment mails |
| `DISABLE_AUTHOR_NOTIFY` | unset | Set, the owner is not told about new comments |
| `AVATAR_PROXY` | unset | A proxy every avatar goes through (`<proxy>?url=<avatar>`) |
| `GRAVATAR_STR` | libravatar | The avatar template for a signed-in user with no profile avatar |
| `IPQPS` | `60` | Seconds between two comments from one IP |
| `FORBIDDEN_WORDS` | unset | Comma-separated words that mark a comment as spam |
| `LEVELS` | unset | Commenter levels by comment count |
| `MARKDOWN_CONFIG` | `{}` | markdown-it options (HTML stays on) |
| `RECAPTCHA_V3_KEY`, `TURNSTILE_KEY` | unset | The login form's captcha site key (public) |
| `PASSKEY_RP_ID`, `PASSKEY_ORIGIN` | the request's host and origin | Pin the WebAuthn relying party. Unset is right for passkeys made on `line.stevehoang.com`; a passkey made under another value only works while that value is set |
| `TIDB_PREFIX`, `TIDB_CHARSET` | `wl_`, `utf8mb4` | The database's table prefix and charset |
| `IP2REGION_DB`, `IP2REGION_DB_V4`, `IP2REGION_DB_V6` | Waline's bundled database | The IP-to-region data the admin's region comes from |
| the notification channels' options (`TG_TEMPLATE`, `DISCORD_TEMPLATE`, `LARK_TEMPLATE`, `QQ_TEMPLATE`, `WX_TEMPLATE`, `SC_TEMPLATE`, `QMSG_HOST`, `QYWX_PROXY`, `QYWX_PROXY_PORT`, `PUSH_PLUS_*`) | Waline's | Only with that channel |

Two are switches, not settings: `ALLOW_REGISTER=true` reopens Waline's
sign-up for an emergency, such as recreating the owner's account on an empty
database (set it, redeploy, `POST /api/user` with `display_name`, `email`,
`password` and a `Referer: https://line.stevehoang.com/` header, which
`SECURE_DOMAINS` asks for, then remove it and redeploy; the first account on
an empty database becomes the administrator; Waline checks sign-up's captcha
too, so while `RECAPTCHA_V3_SECRET` or `TURNSTILE_SECRET` is set this request
gets 403: remove the secret for that deploy as well, or send a fresh
`recaptchaV3` or `turnstile` token in the body), and `PASSKEYS`, the legacy JSON
list of passkeys, imported into the passkey table once (see
[Passkeys](#passkeys)).

Once this is deployed, these can be deleted from the Vercel dashboard, since
nothing reads them or the code sets them: `SITE_URL`, `SERVER_URL`,
`SECURE_DOMAINS`, `OAUTH_URL`, `COMMENT_AUDIT`, `DISABLE_REGION`,
`DISABLE_USERAGENT`, `LOGIN`, `MARKDOWN_TEX`, `MARKDOWN_EMOJI`,
`MARKDOWN_SUB`, `MARKDOWN_SUP`, `MARKDOWN_HIGHLIGHT`, `MARKDOWN_MATHJAX`,
`MARKDOWN_KATEX`, `DEFAULT_AVATAR`, `ALLOWED_ORIGINS`,
`WALINE_ADMIN_MODULE_ASSET_URL` (Waline's `/ui` page is never served), and
`PASSKEYS` once the Profile page says its passkeys are imported. The Node.js
version set in the project's settings is overridden by `engines`.

See `.env.example`.

## Removed

- Page views and reactions (`/api/article`), the comment feed
  (`/api/comment/rss`), public comment counts and recent comments, the public
  top-commenters list, and sign-up verification while sign-up is closed: see
  [Routes](#routes).
- The Users page (`/user`), and with it the user list, banning and editing
  other accounts, on the server as well: only the owner's own account can be
  changed, from Profile.
- Import on the Migration page, and every write to `/api/db`: export is the
  in-app backup. Import emptied each table before it wrote the file back.
- The npm version check and its "new version" banner (it fetched
  `registry.npmjs.org`, now out of the CSP), and the `x-waline-version`
  header the passkey routes copied for it.
- Handing the token to other sites: posting it to `window.opener`, the
  `TOKEN` message listener (and its 50ms wait before every start), the
  `?token=` added to a trusted external redirect after login, and
  `ALLOWED_ORIGINS`. A `redirect` after login is a path on this site only.
- The shell globals `oauthServices`, `ALLOWED_ORIGINS`, `PASSKEY_ENABLED`
  (and the passkey table read it started) and `DEFAULT_AVATAR`; the
  comment sheet's "Browser" row (the API never returns `ua`); Waline's
  `plugins: []` and empty `postSave`; locale keys nothing uses.
- The ten partly translated admin languages (Deutsch, Español, Français,
  Bahasa Indonesia, Italiano, 日本語, 한국어, Português, Русский, 中文繁體). English,
  简体中文 and Tiếng Việt remain, asked for in any case and by any of their
  names (`zh-cn`, `VI-vn` and `vi` are `zh-CN` and `vi-VN`); a language stored
  or asked for (`?lng=`) that the admin no longer has becomes English, in the
  text, in the `lang` the API is asked in and in the stored choice.

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

`npm test` lints before it tests, with the same tools as stevehoang.com:
ESLint (`eslint.config.mjs`: the recommended rules, and React's two hook
rules on `admin/src`), knip (`knip.json`: an unused file, export or
dependency, in the server and the admin alike), Stylelint
(`stylelint-config-standard` on the admin's CSS), then `node --test`.
`npm run fix` fixes what ESLint and Stylelint can. Husky runs `npm test`
before each commit and commitlint checks the message (conventional
commits). The SQLite module the passkey tests load is native and built for
the Node that installed it: run the tests on that Node, or the passkey
suite waits for ever.

`test/ui.test.cjs` runs the router against a stub Waline handler and a
temporary bundle, so it needs neither the database nor a built admin.
`test/passkey.test.cjs` runs the passkey table on SQLite files (through
Waline's own `think-model-sqlite`), checks the MySQL/TiDB DDL as text, and runs
the passkey routes against stub users and a software authenticator (a P-256 key
pair from `node:crypto`), registering, signing in and removing for real.

`test/e2e/admin.e2e.mjs` drives the built admin in Chromium against a fresh
local server (below): `rm -rf .local && IPQPS=0 npm run start:local`,
then `npm run test:e2e` (`BASE` names another server, default `http://localhost:8360`; Playwright must be importable: `npm i --no-save playwright`,
or `PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs`). Screenshots go to `E2E_OUT`
(default `$TMPDIR/wcs-e2e`). The passkey checks use Chromium's virtual
authenticator; only the `PASSKEYS` import check sets it, through the local
server's `/__passkeys`. The avatar checks read `AVATAR_PROXY` from the shell,
so they pass with or without one (`AVATAR_PROXY=https://avatar.example/proxy
npm run start:local` tries the proxied path).

## Running locally

`test/serve-local.cjs` wraps `index.cjs` in a plain HTTP server with SQLite
storage in `.local/`. It needs Waline's empty SQLite
database once, from the Waline repository's `assets/waline.sqlite`:

```sh
curl -Lo /tmp/waline.sqlite https://raw.githubusercontent.com/walinejs/waline/main/assets/waline.sqlite
WALINE_SQLITE_SCHEMA=/tmp/waline.sqlite npm run start:local
```

Then <http://localhost:8360/> is the admin and
`curl 'http://localhost:8360/api/comment?path=/x'` the API. A request with
neither `Referer` nor `Origin` (curl, Node's `fetch`) is given a
`http://localhost:<PORT>/` referer by the local server alone, since
`SECURE_DOMAINS` refuses it otherwise. Sign-up is closed
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
every other path rewritten to it, and sets no environment (see
[Settings](#settings)). Commit `admin/dist` whenever `admin/`
changes, or `/admin.js` answers 503.

The root `package-lock.json` pins every install, and the devDependencies (the
lint and test tools) install on Vercel too. `prepare` is `husky || true`, so an
install without them (`--omit=dev`, `NODE_ENV=production`) cannot fail the
deploy over the missing Git hook tool.
