const path = require('node:path');

process.env.OAUTH_URL = 'data:application/json,{"services":[]}';

const Application = require('@waline/vercel');

const { createAvatar } = require('./lib/avatar.cjs');
const { createPasskey } = require('./lib/passkey.cjs');
const { createUi } = require('./lib/ui.cjs');

const avatarUrl = createAvatar();

const waline = Application({
  plugins: [],
  avatarUrl,
  async postSave() {},
});

const ui = createUi({ bundlePath: path.join(__dirname, 'admin', 'dist', 'admin.js') });

const passkey = createPasskey({
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

  return waline(req, res);
};
