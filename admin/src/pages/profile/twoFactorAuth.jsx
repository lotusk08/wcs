import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { gen2FAToken, get2FAToken, updateProfile } from '../../services/user.js';

export default function TwoFactorAuth() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [updating, setUpdating] = useState(false);
  const [data, setData] = useState({ otpauth_url: '', secret: '' });
  const user = useSelector((state) => state.user);

  useEffect(() => {
    get2FAToken()
      .then(setData)
      .catch(() => {
        // 2FA unavailable
      });
  }, []);

  const on2faUpdate = async (event) => {
    event.preventDefault();

    const code = event.target.code.value;

    if (!code || code.length !== 6) {
      alert(t('minimum 6 characters required'));

      return;
    }

    try {
      setUpdating(true);
      await gen2FAToken({ code, secret: data.secret });
      location.reload();
    } catch (err) {
      alert(err.message);
      setUpdating(false);
    }
  };

  const close2FA = async () => {
    if (!confirm(t('close 2fa confirm'))) {
      return;
    }

    setUpdating(true);
    await updateProfile({ '2fa': '' }).catch((err) => {
      alert(err);
      // oxlint-disable-next-line no-console
      console.error(err);
    });
    setUpdating(false);
    location.reload();
  };

  return (
    <section className="panel" id="two-factor-auth">
      <h2 className="panel-title">{t('two factor auth')}</h2>
      {user['2fa'] ? (
        <div>
          <p>{t('enable 2fa')}</p>
          <div className="qr">
            <QRCodeSVG value={data.otpauth_url || ''} size={200} marginSize={2} />
          </div>
          <button className="btn btn-danger" type="button" onClick={close2FA} disabled={updating}>
            {t('disable 2fa')}
          </button>
        </div>
      ) : null}
      {!user['2fa'] && step === 1 && (
        <div>
          <p>{t('2fa description 1')}</p>
          <p>{t('2fa description 2')}</p>
          <button className="btn btn-primary" type="button" onClick={() => setStep(2)}>
            {t('next step')}
          </button>
        </div>
      )}
      {!user['2fa'] && step === 2 && (
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
          <button className="btn btn-primary" type="submit" onClick={() => setStep(3)}>
            {t('next step')}
          </button>
        </div>
      )}
      {!user['2fa'] && step === 3 && (
        <div>
          <p>{t('open app and scan qrcode')}</p>
          <div className="qr">
            <QRCodeSVG value={data.otpauth_url || ''} size={200} marginSize={2} />
          </div>
          {data.secret ? <p className="muted mono break">{data.secret}</p> : null}
          <form method="post" className="form" onSubmit={on2faUpdate}>
            <label className="field">
              <span className="field-label">{t('input 2fa code')}</span>
              <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input" />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={updating}>
                {t('enable 2fa')}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
