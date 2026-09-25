import cls from 'classnames';
import React from 'react';

export default function Paginator({ current, total, onChange }) {
  if (!total || total < 2) {
    return null;
  }

  const pages = [current - 2, current - 1, current, current + 1, current + 2].filter(
    (page) => page > 0 && page <= total,
  );

  const item = (page, label = page) => (
    <li key={`${label}-${page}`}>
      <button
        type="button"
        className={cls('page-btn', { active: page === current })}
        aria-current={page === current ? 'page' : undefined}
        onClick={() => onChange(page)}
      >
        {label}
      </button>
    </li>
  );

  return (
    <nav className="pager" aria-label="Pagination">
      <ul>
        {current > 1 ? item(current - 1, '‹') : null}
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
        {current < total ? item(current + 1, '›') : null}
      </ul>
    </nav>
  );
}
