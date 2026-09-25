const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it } = require('node:test');

const { createAvatar, defaultAvatar, withDefault } = require('../lib/avatar.cjs');

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const CAT = 'https://stevehoang.com/assets/img/site/cat-avatar.png';

describe('avatar', () => {
  it('uses the cat on stevehoang.com by default', () => {
    assert.equal(defaultAvatar({}), CAT);
    assert.equal(defaultAvatar({ SITE_URL: 'https://example.com/' }), 'https://example.com/assets/img/site/cat-avatar.png');
    assert.equal(defaultAvatar({ DEFAULT_AVATAR: 'https://x.test/a.png' }), 'https://x.test/a.png');
  });

  it('asks libravatar for the cat when the mail has no avatar', () => {
    const url = new URL(createAvatar({})({ mail: ' Reader@Example.com ', nick: 'Reader' }));
    assert.equal(url.hostname, 'seccdn.libravatar.org');
    assert.equal(url.pathname, `/avatar/${md5('reader@example.com')}`);
    assert.equal(url.searchParams.get('d'), CAT);
  });

  it('keeps the owner template and swaps its default image for the cat', () => {
    const avatar = createAvatar({ GRAVATAR_STR: 'https://www.gravatar.com/avatar/{{mail|md5}}?s=80&d=mp&default=identicon' });
    const url = new URL(avatar({ mail: 'a@b.c' }));
    assert.equal(url.hostname, 'www.gravatar.com');
    assert.equal(url.searchParams.get('s'), '80');
    assert.equal(url.searchParams.get('d'), CAT);
    assert.equal(url.searchParams.has('default'), false);
  });

  it('supports sha256 templates and mirrors', () => {
    const avatar = createAvatar({ GRAVATAR_STR: 'https://weavatar.com/avatar/{{mail|sha256}}' });
    const url = new URL(avatar({ mail: 'a@b.c' }));
    assert.equal(url.pathname.length, '/avatar/'.length + 64);
    assert.equal(url.searchParams.get('d'), CAT);
  });

  it('leaves QQ and other avatar services alone', () => {
    const avatar = createAvatar({});
    assert.equal(avatar({ nick: '12345', mail: 'x@y.z' }), 'https://q1.qlogo.cn/g?b=qq&nk=12345&s=100');
    assert.equal(withDefault('https://avatars.example.com/u/1.png', CAT), 'https://avatars.example.com/u/1.png');
    assert.equal(withDefault('not a url', CAT), 'not a url');
  });

  it('falls back to the cat when the template renders nothing', () => {
    assert.equal(createAvatar({ GRAVATAR_STR: '{{ nothing }}' })({}), CAT);
  });
});
