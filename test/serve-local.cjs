const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, '.local');
const schema = process.env.WALINE_SQLITE_SCHEMA;

fs.mkdirSync(dataDir, { recursive: true });

process.env.SQLITE_PATH ||= dataDir;
process.env.JWT_TOKEN ||= 'local-development-secret';

const db = path.join(process.env.SQLITE_PATH, `${process.env.SQLITE_DB || 'waline'}.sqlite`);

if (!fs.existsSync(db)) {
  if (!schema || !fs.existsSync(schema)) {
    console.error(`No database at ${db}. Set WALINE_SQLITE_SCHEMA to Waline's assets/waline.sqlite.`);
    process.exit(1);
  }
  fs.copyFileSync(schema, db);
}

const port = Number(process.env.PORT) || 8360;

const handler = require(path.join(root, 'index.cjs'));

http
  .createServer((req, res) => {
    if (req.url === '/__register' && req.method === 'POST') {
      const allow = process.env.ALLOW_REGISTER;

      process.env.ALLOW_REGISTER = 'true';
      req.url = '/api/user';
      const pending = handler(req, res);

      if (allow === undefined) delete process.env.ALLOW_REGISTER;
      else process.env.ALLOW_REGISTER = allow;

      return Promise.resolve(pending).catch((err) => {
        console.error(err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    }
    if (req.url === '/__passkeys' && req.method === 'POST') {
      const chunks = [];

      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const value = Buffer.concat(chunks).toString('utf8').trim();

        if (value) process.env.PASSKEYS = value;
        else delete process.env.PASSKEYS;
        res.writeHead(204);
        res.end();
      });
      return;
    }
    req.headers['x-forwarded-proto'] ||= 'http';
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  })
  .listen(port, () => console.log(`http://localhost:${port}/`));
