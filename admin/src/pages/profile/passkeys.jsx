import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import Icon from '../../components/icon/ui.jsx';
import { getPasskeys, passkeyRegister, passkeyRegisterOptions } from '../../services/passkey.js';
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

export default function Passkeys() {
  const { t, i18n } = useTranslation();
  const [list, setList] = useState(null);
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const valueRef = useRef(null);
  const supported = passkeySupported();

  useEffect(() => {
    let alive = true;

    getPasskeys().then(
      (data) => {
        if (!alive) return;
        setList(Array.isArray(data.passkeys) ? data.passkeys : []);
        if (data.status === 'invalid') setError(t('passkey env invalid'));
      },
      () => {
        if (!alive) return;
        setList([]);
        setError(t('passkey list error'));
      },
    );

    return () => {
      alive = false;
    };
  }, [t]);

  useEffect(() => {
    if (!copied) return undefined;

    const timer = setTimeout(() => setCopied(false), 1800);

    return () => clearTimeout(timer);
  }, [copied]);

  const onAdd = async (event) => {
    event.preventDefault();

    if (adding) return;

    const form = event.currentTarget;
    const name = form.passkeyName.value.trim();

    setAdding(true);
    setError('');

    try {
      const { options, challengeToken } = await passkeyRegisterOptions();
      const response = await ceremony(() => startRegistration({ optionsJSON: options }), options.timeout);
      const data = await passkeyRegister({ challengeToken, response, name });

      form.reset();
      setCopied(false);
      setResult(data);
    } catch (err) {
      if (!isAborted(err)) setError(describePasskey(t, err, { register: true }));
    } finally {
      setAdding(false);
    }
  };

  const onCopy = async () => {
    const value = result?.value ?? '';

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      const field = valueRef.current;

      field?.focus();
      field?.select();
      setCopied(document.execCommand?.('copy') === true);
    }
  };

  return (
    <section className="panel" id="passkeys">
      <h2 className="panel-title">{t('passkeys')}</h2>
      <p>{t('passkeys description')}</p>

      {list === null ? (
        <p className="muted">{t('loading')}</p>
      ) : list.length ? (
        <ul className="passkey-list">
          {list.map((item) => (
            <li key={item.id} className="passkey-item">
              <Icon name="passkey" size={20} />
              <span className="passkey-item-text">
                <span className="passkey-item-name">{item.name}</span>
                <span className="passkey-item-meta">
                  {formatDate(item.createdAt, i18n.language)
                    ? t('passkey added', { date: formatDate(item.createdAt, i18n.language) })
                    : t('passkey')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t('no passkeys')}</p>
      )}

      {result ? (
        <div className="passkey-result" role="status">
          <p className="passkey-result-title">{t('passkey created')}</p>
          <ol className="passkey-steps">
            <li>{t('passkey step copy')}</li>
            <li>
              <Trans i18nKey="passkey step vercel" components={{ code: <code />, b: <strong /> }} />
            </li>
            <li>{t('passkey step redeploy')}</li>
          </ol>
          <label className="field">
            <span className="field-label">
              <code>PASSKEYS</code>
            </span>
            <textarea
              ref={valueRef}
              readOnly
              className="input mono passkey-value"
              value={result.value}
              rows={5}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onCopy}>
              <Icon name={copied ? 'check' : 'copy'} size={18} />
              <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
            </button>
            <button type="button" className="btn" onClick={() => setResult(null)}>
              {t('done')}
            </button>
          </div>
        </div>
      ) : (
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
            <button type="submit" className="btn btn-primary" disabled={adding || !supported}>
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

      <p className="field-hint passkey-hint">
        <Trans i18nKey="passkey remove hint" components={{ code: <code /> }} />
      </p>
    </section>
  );
}
