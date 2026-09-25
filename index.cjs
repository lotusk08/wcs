const path = require('node:path');

const Application = require('@waline/vercel');

const { createUi } = require('./lib/ui.cjs');

const waline = Application({
  plugins: [],
  async postSave() {},
});

const ui = createUi({ bundlePath: path.join(__dirname, 'admin', 'dist', 'admin.js') });

module.exports = async (req, res) => {
  if (!(await ui(req, res))) return waline(req, res);
};
