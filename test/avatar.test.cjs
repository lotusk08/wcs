const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, it } = require('node:test');

const { createAvatar, withDefault } = require('../lib/avatar.cjs');

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const CAT = 'https://stevehoang.com/assets/img/cat.webp';

describe('avatar', () => {
  it('gives a guest comment the cat on stevehoang.com directly, whatever the mail, nick, template or settings', () => {
    for (const env of [{}, { GRAVATAR_STR: 'https://www.gravatar.com/avatar/{{mail|md5}}' }, { SITE_URL: 'https://example.com', DEFAULT_AVATAR: 'https://x.test/a.png' }]) {
      const avatar = createAvatar(env);
      for (const user_id of [undefined, null, '', 0]) {
        assert.equal(avatar({ user_id, mail: 'reader@example.com', nick: 'Reader', comment: 'hi' }), CAT, `${JSON.stringify(env)} ${user_id}`);
      }
      assert.equal(avatar({ user_id: null, nick: '12345', mail: '12345@qq.com' }), CAT);
    }
  });

  it('asks libravatar for a signed-in user without a profile avatar, the cat as its fallback', () => {
    const avatar = createAvatar({ SITE_URL: 'https://example.com', DEFAULT_AVATAR: 'https://x.test/a.png' });
    for (const user of [{ mail: ' Owner@Example.com ', nick: 'Owner' }, { user_id: '1', mail: 'owner@example.com', nick: 'Owner' }]) {
      const url = new URL(avatar(user));
      assert.equal(url.hostname, 'seccdn.libravatar.org');
      assert.equal(url.pathname, `/avatar/${md5('owner@example.com')}`);
      assert.equal(url.searchParams.get('d'), CAT);
    }
  });

  it('no longer asks QQ for a numeric nick or a qq.com mail', () => {
    const avatar = createAvatar({});
    for (const user of [{ nick: '12345', mail: 'x@y.z' }, { nick: 'x', mail: '12345@qq.com' }]) {
      assert.equal(new URL(avatar(user)).hostname, 'seccdn.libravatar.org');
    }
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

  it('leaves other avatar services alone', () => {
    assert.equal(withDefault('https://avatars.example.com/u/1.png', CAT), 'https://avatars.example.com/u/1.png');
    assert.equal(withDefault('not a url', CAT), 'not a url');
  });

  it('falls back to the cat when the template renders nothing', () => {
    assert.equal(createAvatar({ GRAVATAR_STR: '{{ nothing }}' })({}), CAT);
  });
});
