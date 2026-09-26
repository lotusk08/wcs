import cls from 'classnames';
import React from 'react';
import { useTranslation } from 'react-i18next';

import Icon from './icon/ui.jsx';

export default function Notice({ children, onClose, tone = 'error', floating = false, className, id }) {
  const { t } = useTranslation();

  if (!children) return null;

  return (
    <div
      id={id}
      className={cls('notice', `notice-${tone}`, { 'notice-floating': floating }, className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={tone === 'success' ? 'done' : 'alert'} size={18} className="notice-icon" />
      <span className="notice-text">{children}</span>
      {onClose ? (
        <button type="button" className="notice-close" aria-label={t('close')} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}
