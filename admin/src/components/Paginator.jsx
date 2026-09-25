import cls from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from './icon/ui.jsx';

export default function Paginator({ current, total, onChange }) {
  const { t } = useTranslation();

  if (!total || total < 2) {
    return null;
  }

  const pages = [current - 2, current - 1, current, current + 1, current + 2].filter(
    (page) => page > 0 && page <= total,
  );

  const item = (page, label = page, name) => (
    <li key={`${label}-${page}`}>
      <button
        type="button"
        className={cls('page-btn', { active: page === current })}
        aria-current={page === current ? 'page' : undefined}
        aria-label={name}
        onClick={() => onChange(page)}
      >
        {label}
      </button>
    </li>
  );

  return (
    <nav className="pager" aria-label={t('pagination')}>
      <ul className="pager-full">
        {current > 1 ? item(current - 1, '‹', t('previous page')) : null}
        {pages[0] > 1 ? item(1) : null}
        {pages[0] > 2 ? (
          <li className="gap" aria-hidden="true">
            …
          </li>
        ) : null}
        {pages.map((page) => item(page))}
        {pages.at(-1) < total - 1 ? (
          <li className="gap" aria-hidden="true">
            …
          </li>
        ) : null}
        {pages.at(-1) < total ? item(total) : null}
        {current < total ? item(current + 1, '›', t('next page')) : null}
      </ul>
      <div className="pager-compact">
        <button type="button" className="btn pager-step" disabled={current <= 1} onClick={() => onChange(current - 1)}>
          <Icon name="prev" size={18} />
          <span>{t('previous page')}</span>
        </button>
        <span className="pager-status" aria-live="polite">
          {t('page {{current}} of {{total}}', { current, total })}
        </span>
        <button type="button" className="btn pager-step" disabled={current >= total} onClick={() => onChange(current + 1)}>
          <span>{t('next page')}</span>
          <Icon name="next" size={18} />
        </button>
      </div>
    </nav>
  );
}
