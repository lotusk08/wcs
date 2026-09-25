import cls from 'classnames';
import React from 'react';
import { useSelector } from 'react-redux';

import Header from './Header.jsx';

export default function Layout({ children, title, actions, narrow = false, className }) {
  const user = useSelector((state) => state.user);
  const tabbar = user?.type === 'administrator';

  return (
    <div className={cls('shell', { 'has-tabbar': tabbar })}>
      <Header title={title} />
      <main className={cls('page', className, { 'page-narrow': narrow })}>
        {title ? (
          <div className="page-head">
            <h1 className="page-title">{title}</h1>
            {actions}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
