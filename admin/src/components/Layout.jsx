import cls from 'classnames';
import React from 'react';

import Header from './Header.jsx';

export default function Layout({ children, narrow = false }) {
  return (
    <div className="shell">
      <Header />
      <main className={cls('page', { 'page-narrow': narrow })}>{children}</main>
    </div>
  );
}
