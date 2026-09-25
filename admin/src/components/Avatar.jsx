import cls from 'classnames';
import React, { useState } from 'react';

import { DEFAULT_AVATAR, buildAvatar } from '../pages/manage-comments/utils.js';

export default function Avatar({ src, size = 32, alt = '', className }) {
  const url = buildAvatar(src);
  const [failed, setFailed] = useState([]);
  const own = url && !failed.includes(url) ? url : '';
  const shown = own || (failed.includes(DEFAULT_AVATAR) ? '' : DEFAULT_AVATAR);

  if (!shown) {
    return <span className={cls('avatar', 'avatar-blank', className)} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : 'true'} />;
  }

  return (
    <img
      key={shown}
      className={cls('avatar', className, { 'avatar-default': !own })}
      src={shown}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed((prev) => (prev.includes(shown) ? prev : [...prev, shown]))}
    />
  );
}
