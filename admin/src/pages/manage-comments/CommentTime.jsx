import React from 'react';
import { useTranslation } from 'react-i18next';

import { formatDate, parseDate, relativeDate } from './utils.js';

export default function CommentTime({ value, className = 'comment-time' }) {
  const { t, i18n } = useTranslation();
  const date = parseDate(value);
  const label = relativeDate(value, i18n.language);

  return (
    <time
      className={className}
      dateTime={Number.isNaN(date.getTime()) ? undefined : date.toISOString()}
      title={formatDate(value)}
    >
      {label ?? t('just now')}
    </time>
  );
}
