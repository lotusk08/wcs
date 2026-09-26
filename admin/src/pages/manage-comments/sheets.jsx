import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AutoTextarea from '../../components/AutoTextarea.jsx';
import Avatar from '../../components/Avatar.jsx';
import BottomSheet from '../../components/BottomSheet.jsx';
import Icon from '../../components/icon/ui.jsx';
import { externalLink } from '../../utils/site.js';
import { excerpt, formatDate, getPostUrl, hasRegion } from './utils.js';

function CopyButton({ value, onError }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className="icon-btn copy-btn"
      aria-label={copied ? t('copied') : t('copy')}
      title={copied ? t('copied') : t('copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch (err) {
          onError?.(err.message);
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={18} />
      <span className="copy-state" aria-live="polite">
        {copied ? t('copied') : ''}
      </span>
    </button>
  );
}

export function CommentSheet({ open, comment, actions, onClose, onError }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) setConfirming(false);
  }, [open, comment?.objectId]);

  if (!comment) return <BottomSheet open={false} onClose={onClose} />;

  const { nick, mail, link, ip, addr, ua, url, insertedAt, time } = comment;
  const remove = actions.find(({ key }) => key === 'delete');
  const header = (
    <div className="sheet-account">
      <Avatar src={comment.avatar} size={44} className="sheet-avatar" />
      <div className="sheet-heading">
        <h2 className="sheet-title">{nick}</h2>
        <p className="sheet-subtitle">{formatDate(insertedAt ?? time)}</p>
      </div>
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} header={header} className="comment-sheet">
      <dl className="detail-list">
        {mail ? (
          <div className="detail">
            <dt>{t('email')}</dt>
            <dd className="detail-copy">
              <a href={`mailto:${mail}`}>{mail}</a>
              <CopyButton value={mail} onError={onError} />
            </dd>
          </div>
        ) : null}
        {link ? (
          <div className="detail">
            <dt>{t('homepage')}</dt>
            <dd>
              <a href={externalLink(link)} rel="external nofollow noreferrer" target="_blank">
                {link}
              </a>
            </dd>
          </div>
        ) : null}
        <div className="detail">
          <dt>{t('post')}</dt>
          <dd>
            <a href={getPostUrl(url)} target="_blank" rel="noreferrer">
              {url}
            </a>
          </dd>
        </div>
        {ip ? (
          <div className="detail">
            <dt>{t('ip')}</dt>
            <dd className="mono">{ip}</dd>
          </div>
        ) : null}
        {hasRegion(addr) ? (
          <div className="detail">
            <dt>{t('region')}</dt>
            <dd>{addr}</dd>
          </div>
        ) : null}
        {ua ? (
          <div className="detail">
            <dt>{t('user agent')}</dt>
            <dd className="detail-ua">{ua}</dd>
          </div>
        ) : null}
      </dl>

      {confirming && remove ? (
        <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-delete-text">
          <p id="confirm-delete-text">
            {t('delete one confirm', { nick })} {t('cannot be undone')}
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {t('cancel')}
            </button>
            {/* oxlint-disable-next-line jsx-a11y/no-autofocus */}
            <button type="button" className="btn btn-danger btn-solid act-delete-confirm" data-autofocus onClick={remove.run}>
              <Icon name="trash" size={18} />
              {t('delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="sheet-actions">
          {actions.map(({ key, name, icon, run }) => (
            <button
              type="button"
              key={key}
              className={`sheet-item act-${key}${key === 'delete' ? ' danger' : ''}`}
              onClick={key === 'delete' ? () => setConfirming(true) : run}
            >
              <Icon name={icon} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

export function ReplySheet({ open, comment, seq, onSend, onClose }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) setSending(false);
  }, [open]);

  const onSubmit = async (event) => {
    event.preventDefault();

    const text = event.currentTarget.text.value;

    if (!text.trim()) return;

    setSending(true);
    try {
      await onSend(text);
    } catch {
      setSending(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={comment ? t('reply to {{nick}}', { nick: comment.nick }) : ''}
      subtitle={comment ? excerpt(comment.comment) : ''}
      className="compose-sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="reply-form" className="btn btn-primary btn-solid" disabled={sending}>
            <Icon name="reply" size={18} />
            {sending ? t('loading') : t('send')}
          </button>
        </>
      }
    >
      <form id="reply-form" key={seq} className="comment-reply form" onSubmit={onSubmit}>
        <label className="field">
          <span className="sr-only">{t('content')}</span>
          <AutoTextarea name="text" className="input compose" rows="4" data-autofocus />
        </label>
      </form>
    </BottomSheet>
  );
}

export function EditSheet({ open, comment, seq, onSave, onClose }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSaving(false);
  }, [open]);

  const onSubmit = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const data = {
      nick: form.nick.value,
      mail: form.mail.value,
      link: form.link.value,
      comment: form.comment.value,
    };

    setSaving(true);
    try {
      await onSave(data);
    } catch {
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('edit comment')}
      className="compose-sheet"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="edit-form" className="btn btn-primary btn-solid" disabled={saving}>
            <Icon name="check" size={18} />
            {saving ? t('loading') : t('save')}
          </button>
        </>
      }
    >
      {comment ? (
        <form id="edit-form" key={seq} className="comment-editor form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">{t('content')}</span>
            <AutoTextarea name="comment" rows="5" className="input compose mono" defaultValue={comment.orig ?? comment.comment} data-autofocus />
          </label>
          <div className="editor-grid">
            <label className="field">
              <span className="field-label">{t('username')}</span>
              <input className="input" name="nick" type="text" autoComplete="off" defaultValue={comment.nick} />
            </label>
            <label className="field">
              <span className="field-label">{t('email')}</span>
              <input className="input" name="mail" type="email" autoComplete="off" defaultValue={comment.mail} />
            </label>
            <label className="field">
              <span className="field-label">{t('homepage')}</span>
              <input className="input" name="link" type="text" autoComplete="off" defaultValue={comment.link} />
            </label>
          </div>
        </form>
      ) : null}
    </BottomSheet>
  );
}
