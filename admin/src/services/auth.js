import request from '../utils/request.js';
import { storage } from '../utils/site.js';

export const login = ({ email, password, code, recaptchaV3, turnstile }) =>
  request({
    url: 'token',
    method: 'POST',
    auth: false,
    body: { email, password, code, recaptchaV3, turnstile },
  });

export const saveToken = (token, remember) => {
  window.TOKEN = token;
  storage.set('sessionStorage', 'TOKEN', token);
  if (remember) storage.set('localStorage', 'TOKEN', token);
  else storage.remove('localStorage', 'TOKEN');
};

export const logout = () => {
  window.TOKEN = null;
  storage.remove('sessionStorage', 'TOKEN');
  storage.remove('localStorage', 'TOKEN');
};

export const forgot = ({ email }) =>
  request({
    url: 'user/password',
    method: 'PUT',
    auth: false,
    body: { email },
  });

export const getUserInfo = () => request('token');
