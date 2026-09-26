import request from '../utils/request.js';

export const getPasskeys = () => request({ url: 'passkey', method: 'GET' });

export const passkeyRegisterOptions = () => request({ url: 'passkey/register/options', method: 'POST', body: {} });

export const passkeyRegister = (body) => request({ url: 'passkey/register', method: 'POST', body });

export const passkeyLoginOptions = () =>
  request({ url: 'passkey/login/options', method: 'POST', auth: false, body: {} });

export const passkeyLogin = (body) => request({ url: 'passkey/login', method: 'POST', auth: false, body });
