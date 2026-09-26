import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import BottomSheet from '../../components/BottomSheet.jsx';
import Icon from '../../components/icon/ui.jsx';
import Notice from '../../components/Notice.jsx';
import { gen2FAToken, get2FAToken, updateProfile } from '../../services/user.js';

const CODE = /^\d{6}$/u;

export default function TwoFactorAuth() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const [step, setStep] = useState(1);
  const [updating, setUpdating] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [notice, setNotice] = useState(null);
  const [codeError, setCodeError] = useState(false);
  const [data, setData] = useState({ otpauth_url: '', secret: '' });
  const codeRef = useRef(null);
  const user = useSelector((state) => state.user);
  const enabled = Boolean(user['2fa']);

  const load = () =>
    get2FAToken()
      .then(setData)
      .catch(() => {
        // 2FA unavailable
      });

  useEffect(() => {
    load();
  }, []);

  const on2faUpdate = async (event) => {
    event.preventDefault();

    const code = event.currentTarget.code.value.replace(/\s+/gu, '');

    setNotice(null);
    if (!CODE.test(code)) {
      setCodeError(code ? t('2fa code format') : t('please input 2fa code'));
      codeRef.current?.focus();

      return;
    }

    setCodeError(false);
    setUpdating(true);
    try {
      await gen2FAToken({ code, secret: data.secret });
      dispatch.user.updateUser({ '2fa': data.secret });
      setShowQr(false);
      setStep(1);
      setNotice({ tone: 'success', text: t('2fa now on') });
    } catch (err) {
      setCodeError(err?.errno === 'network' ? t('network error') : t('2fa setup code error'));
      if (codeRef.current) {
        codeRef.current.value = '';
        codeRef.current.focus();
      }
    } finally {
      setUpdating(false);
    }
  };

  const close2FA = async () => {
    setUpdating(true);
    setNotice(null);
    try {
      await updateProfile({ '2fa': '' });
      dispatch.user.updateUser({ '2fa': '' });
      setConfirmOff(false);
      setStep(1);
      setNotice({ tone: 'success', text: t('2fa now off') });
      load();
    } catch (err) {
      setConfirmOff(false);
      setNotice({ tone: 'error', text: err?.message || t('request failed') });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <section className="panel" id="two-factor-auth">
      <h2 className="panel-title">{t('two factor auth')}</h2>
      <Notice tone={notice?.tone} onClose={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      {enabled ? (
        <div>
          <p>{t('2fa is on')}</p>
          {showQr ? (
            <div className="qr" id="tfa-qr">
              <QRCodeSVG value={data.otpauth_url || ''} size={200} marginSize={2} />
            </div>
          ) : null}
          <div className="form-actions">
            <button
              className="btn act-2fa-qr"
              type="button"
              aria-expanded={showQr}
              aria-controls={showQr ? 'tfa-qr' : undefined}
              onClick={() => setShowQr((value) => !value)}
              disabled={!data.otpauth_url}
            >
              {showQr ? t('hide 2fa qr') : t('show 2fa qr')}
            </button>
            <button
              className="btn btn-danger act-2fa-off"
              type="button"
              onClick={() => {
                setNotice(null);
                setConfirmOff(true);
              }}
              disabled={updating}
            >
              {t('disable 2fa')}
            </button>
          </div>
        </div>
      ) : null}
      {!enabled && step === 1 && (
        <div>
          <p>{t('2fa description 1')}</p>
          <p>{t('2fa description 2')}</p>
          <button className="btn btn-primary" type="button" onClick={() => setStep(2)}>
            {t('next step')}
          </button>
        </div>
      )}
      {!enabled && step === 2 && (
        <div>
          <h4>{t('download 2fa app')}</h4>
          <ul className="step2-apps">
            <li>
              For Android, iOS:
              <a target="_blank" rel="noreferrer" href="https://support.google.com/accounts/answer/1066447?hl=en">
                {' '}
                Google Authenticator
              </a>
            </li>
            <li>
              For Android and iOS:
              <a target="_blank" rel="noreferrer" href="https://guide.duosecurity.com/third-party-accounts"> Duo Mobile</a>
            </li>
            <li>
              For Windows Phone:
              <a target="_blank" rel="noreferrer" href="https://www.microsoft.com/en-US/store/apps/Authenticator/9WZDNCRFJ3RJ">
                {' '}
                Authenticator
              </a>
            </li>
          </ul>
          <button className="btn btn-primary" type="button" onClick={() => setStep(3)}>
            {t('next step')}
          </button>
        </div>
      )}
      {!enabled && step === 3 && (
        <div>
          <p>{t('open app and scan qrcode')}</p>
          <div className="qr">
            <QRCodeSVG value={data.otpauth_url || ''} size={200} marginSize={2} />
          </div>
          {data.secret ? <p className="muted mono break">{data.secret}</p> : null}
          <form method="post" name="enable2fa" className="form" onSubmit={on2faUpdate} noValidate>
            <label className="field">
              <span className="field-label">{t('input 2fa code')}</span>
              <input
                ref={codeRef}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={7}
                className="input input-code input-code-sm"
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'tfa-code-error' : undefined}
                onInput={() => codeError && setCodeError(false)}
              />
              {codeError ? (
                <span className="field-error" id="tfa-code-error" role="alert">
                  <Icon name="alert" size={16} />
                  {codeError}
                </span>
              ) : null}
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={updating} aria-busy={updating}>
                {updating ? t('verifying code') : t('enable 2fa')}
              </button>
            </div>
          </form>
        </div>
      )}
      <BottomSheet open={confirmOff} onClose={() => !updating && setConfirmOff(false)} title={t('disable 2fa')}>
        <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-2fa-text">
          <p id="confirm-2fa-text">{t('close 2fa confirm')}</p>
          <div className="confirm-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setConfirmOff(false)} disabled={updating}>
              {t('keep 2fa')}
            </button>
            <button type="button" className="btn btn-danger btn-solid act-2fa-off-confirm" onClick={close2FA} disabled={updating}>
              {t('turn off 2fa')}
            </button>
          </div>
        </div>
      </BottomSheet>
    </section>
  );
}
