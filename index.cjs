const path = require('node:path');

const SECURE_DOMAINS = ['stevehoang.com', 'line.stevehoang.com'];

Object.assign(process.env, {
  SITE_URL: 'https://stevehoang.com',
  SECURE_DOMAINS: SECURE_DOMAINS.join(','),
  OAUTH_URL: 'data:application/json,{"services":[]}',
  COMMENT_AUDIT: 'true',
  DISABLE_REGION: 'true',
  MARKDOWN_TEX: 'false',
  MARKDOWN_EMOJI: 'false',
  MARKDOWN_SUB: 'false',
  MARKDOWN_SUP: 'false',
});

for (const name of ['LOGIN', 'DISABLE_USERAGENT', 'MARKDOWN_HIGHLIGHT']) delete process.env[name];

if (process.env.VERCEL_ENV === 'production') process.env.SERVER_URL = 'https://line.stevehoang.com';
else delete process.env.SERVER_URL;

const Application = require('@waline/vercel');

const { createAvatar } = require('./lib/avatar.cjs');
const { createPasskey } = require('./lib/passkey.cjs');
const { createPasskeyStore } = require('./lib/passkey-store.cjs');
const { createUi } = require('./lib/ui.cjs');

const avatarUrl = createAvatar();

const line = Application({ avatarUrl });

const store = createPasskeyStore({
  type: think.config('storage'),
  model: () => think.model('Passkeys'),
});

const ui = createUi({
  bundlePath: path.join(__dirname, 'admin', 'dist', 'admin.js'),
  clientPath: path.join(__dirname, 'client', 'dist', 'line.js'),
  jwtKey: () => think.config('jwtKey'),
});

const passkey = createPasskey({
  store,
  jwtKey: () => think.config('jwtKey'),
  async findUser(objectId) {
    const users = await think.service(`storage/${think.config('storage')}`, 'Users').select({ objectId });

    return users?.[0] ?? null;
  },
  avatar: (user) => user.avatar || avatarUrl({ mail: user.email, nick: user.display_name, link: user.url }),
  avatarProxy: () => think.config('avatarProxy'),
});

module.exports = async (req, res) => {
  if (await ui(req, res)) return;
  if (await passkey(req, res)) return;

  think.config('secureDomains', [...SECURE_DOMAINS]);

  return line(req, res);
};
