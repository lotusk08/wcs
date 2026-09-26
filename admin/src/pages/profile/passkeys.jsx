import cls from 'classnames';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '../../components/icon/ui.jsx';
import { getPasskeys, passkeyRegister, passkeyRegisterOptions, removePasskey } from '../../services/passkey.js';
import { ceremony, describePasskey, isAborted, passkeySupported, startRegistration } from '../../utils/passkey.js';

const formatDate = (value, language) => {
  const date = new Date(value);

  if (!value || Number.isNaN(date.getTime())) return '';

  try {
    return date.toLocaleDateString(language, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

const isDuplicate = (err) => err?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || err?.errno === 'passkey_exists';

function PasskeyItem({ item, fresh, readOnly, confirming, removing, onAsk, onCancel, onRemove }) {
  const { t, i18n } = useTranslation();
  const askRef = useRef(null);
  const confirmRef = useRef(null);
  const wasConfirming = useRef(false);
  const added = formatDate(item.createdAt, i18n.language);
  const used = formatDate(item.lastUsedAt, i18n.language);
  const textId = `passkey-confirm-${item.id}`;

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) askRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <li className={cls('passkey-item', { confirming, fresh })}>
      <div className="passkey-row">
        <Icon name="passkey" size={20} />
        <span className="passkey-item-text">
          <span className="passkey-item-name">{item.name}</span>
          <span className="passkey-item-meta">
            {[added ? t('passkey added', { date: added }) : '', used ? t('passkey last used', { date: used }) : t('passkey never used')]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {confirming || readOnly ? null : (
          <button
            ref={askRef}
            type="button"
            className="btn btn-quiet passkey-remove"
            aria-label={t('remove passkey named', { name: item.name })}
            onClick={onAsk}
          >
            <Icon name="trash" size={18} />
            <span>{t('remove')}</span>
          </button>
        )}
      </div>
      {confirming ? (
        <div
          className="confirm-box passkey-confirm"
          role="alertdialog"
          aria-labelledby={textId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
        >
          <p id={textId}>
            {t('remove passkey confirm', { name: item.name })}
            {item.inEnv ? ` ${t('passkey remove env note')}` : ''}
          </p>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={removing}>
              {t('cancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className="btn btn-danger btn-solid act-passkey-remove"
              onClick={onRemove}
              disabled={removing}
            >
              <Icon name="trash" size={18} />
              <span>{removing ? t('loading') : t('remove')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export default function Passkeys() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [status, setStatus] = useState(null);
  const [exists, setExists] = useState(false);
  const [error, setError] = useState('');
  const statusRef = useRef(null);
  const supported = passkeySupported();
  const list = data ? data.passkeys : null;
  const envOnly = data?.storage === 'env';

  useEffect(() => {
    let alive = true;

    getPasskeys().then(
      (next) => {
        if (!alive) return;
        setData({ ...next, passkeys: Array.isArray(next.passkeys) ? next.passkeys : [] });
      },
      () => {
        if (!alive) return;
        setData({ passkeys: [] });
        setError(t('passkey list error'));
      },
    );

    return () => {
      alive = false;
    };
  }, [t]);

  const update = (next) => setData({ ...next, passkeys: Array.isArray(next.passkeys) ? next.passkeys : [] });

  const onAdd = async (event) => {
    event.preventDefault();

    if (adding) return;

    const form = event.currentTarget;
    const name = form.passkeyName.value.trim();

    setAdding(true);
    setError('');
    setExists(false);
    setStatus(null);
    setConfirmId(null);

    try {
      const { options, challengeToken } = await passkeyRegisterOptions();
      const response = await ceremony(() => startRegistration({ optionsJSON: options }), options.timeout);
      const next = await passkeyRegister({ challengeToken, response, name });

      form.reset();
      update(next);
      setStatus({ kind: 'added', id: next.entry?.id, name: next.entry?.name ?? '' });
    } catch (err) {
      if (isDuplicate(err)) setExists(true);
      else if (!isAborted(err)) setError(describePasskey(t, err, { register: true }));
    } finally {
      setAdding(false);
    }
  };

  const onRemove = async (item) => {
    if (removing) return;

    setRemoving(true);
    setError('');

    try {
      const next = await removePasskey(item.id);

      update(next);
      setConfirmId(null);
      setExists(false);
      setStatus({ kind: 'removed', name: item.name, stillInEnv: next.stillInEnv === true });
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (err) {
      setError(err?.errno === 'passkey_unknown' ? t('passkey already removed') : t('passkey remove failed'));
      if (err?.errno === 'passkey_unknown') {
        setConfirmId(null);
        getPasskeys().then(update, () => {});
      }
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="panel" id="passkeys">
      <h2 className="panel-title">{t('passkeys')}</h2>
      <p>{t('passkeys description')}</p>

      {envOnly ? (
        <div className="passkey-note" role="note">
          <p>{t('passkey storage env')}</p>
          {data.notice?.message ? <p className="field-hint">{data.notice.message}</p> : null}
        </div>
      ) : null}

      {list === null ? (
        <p className="muted">{t('loading')}</p>
      ) : list.length ? (
        <ul className="passkey-list">
          {list.map((item) => (
            <PasskeyItem
              key={item.id}
              item={item}
              fresh={status?.kind === 'added' && status.id === item.id}
              readOnly={envOnly}
              confirming={confirmId === item.id}
              removing={removing && confirmId === item.id}
              onAsk={() => {
                setConfirmId(item.id);
                setError('');
              }}
              onCancel={() => setConfirmId(null)}
              onRemove={() => onRemove(item)}
            />
          ))}
        </ul>
      ) : (
        <p className="muted">{t('no passkeys')}</p>
      )}

      {status ? (
        <p ref={statusRef} tabIndex={-1} className="passkey-status" role="status">
          <Icon name="check" size={18} />
          <span>
            {status.kind === 'added'
              ? t('passkey saved', { name: status.name })
              : `${t('passkey removed', { name: status.name })}${status.stillInEnv ? ` ${t('passkey removed env')}` : ''}`}
          </span>
        </p>
      ) : null}

      {exists ? (
        <div className="passkey-note passkey-exists" role="alert">
          <p className="passkey-note-title">{t('passkey exists')}</p>
          <p>{t('passkey exists replace')}</p>
        </div>
      ) : null}

      {envOnly ? null : (
        <form method="post" name="passkey" className="form passkey-add" onSubmit={onAdd}>
          <label className="field">
            <span className="field-label">{t('passkey name')}</span>
            <input
              name="passkeyName"
              type="text"
              className="input"
              maxLength={64}
              autoComplete="off"
              placeholder={t('passkey name placeholder')}
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary act-passkey-add" disabled={adding || !supported || list === null}>
              <Icon name="passkey" size={18} />
              <span>{adding ? t('loading') : t('add passkey')}</span>
            </button>
          </div>
          {supported ? null : <p className="field-hint">{t('passkey unsupported')}</p>}
        </form>
      )}

      {error ? (
        <p className="passkey-error" role="alert">
          {error}
        </p>
      ) : null}

      {data?.status === 'invalid' ? <p className="field-hint passkey-hint">{t('passkey env invalid')}</p> : null}
      {!envOnly && list?.some((item) => item.inEnv) ? (
        <p className="field-hint passkey-hint">{t('passkey env imported')}</p>
      ) : null}
    </section>
  );
}
