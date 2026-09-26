const path = require('node:path');

const Application = require('@waline/vercel');

const { createAvatar } = require('./lib/avatar.cjs');
const { createUi } = require('./lib/ui.cjs');
const { createWidget } = require('./lib/widget.cjs');

const waline = Application({
  plugins: [],
  avatarUrl: createAvatar(),
  async postSave() {},
});

const widget = createWidget();
const ui = createUi({ bundlePath: path.join(__dirname, 'admin', 'dist', 'admin.js') });

module.exports = async (req, res) => {
  if (widget(req, res)) return;
  if (!(await ui(req, res))) return waline(req, res);
};
