const path = require('node:path');

process.env.OAUTH_URL = 'data:application/json,{"services":[]}';

const Application = require('@waline/vercel');

const { createAvatar } = require('./lib/avatar.cjs');
const { createUi } = require('./lib/ui.cjs');

const waline = Application({
  plugins: [],
  avatarUrl: createAvatar(),
  async postSave() {},
});

const ui = createUi({ bundlePath: path.join(__dirname, 'admin', 'dist', 'admin.js') });

module.exports = async (req, res) => {
  if (!(await ui(req, res))) return waline(req, res);
};
