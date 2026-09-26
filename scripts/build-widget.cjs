const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const version = process.argv[2] || '3.15.2';
const target = path.join(__dirname, '..', 'widget', 'waline.css');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waline-client-'));

try {
  const tarball = execFileSync('npm', ['pack', `@waline/client@${version}`, '--silent', '--pack-destination', dir], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .pop();

  execFileSync('tar', ['-xzf', path.join(dir, tarball), '-C', dir, 'package/dist/waline.css']);

  const css = fs
    .readFileSync(path.join(dir, 'package', 'dist', 'waline.css'), 'utf8')
    .replace(/\/\*# sourceMappingURL=[^*]*\*\/\s*$/u, '')
    .trimEnd();

  fs.writeFileSync(target, `/* @waline/client@${version} dist/waline.css */\n${css}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), target)} from @waline/client@${version}`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
