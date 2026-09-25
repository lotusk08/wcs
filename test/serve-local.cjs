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

process.env.OAUTH_URL ||= `http://127.0.0.1:${port}/__oauth`;

const handler = require(path.join(root, 'index.cjs'));

http
  .createServer((req, res) => {
    if (req.url === '/__oauth') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"services":[{"name":"github"}]}');
    }
    req.headers['x-forwarded-proto'] ||= 'http';
    Promise.resolve(handler(req, res)).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  })
  .listen(port, () => console.log(`http://localhost:${port}/`));
