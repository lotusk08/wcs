import request from '../utils/request.js';

export const get2FAToken = () => request({ url: 'token/2fa', method: 'GET' });

export const get2FAStatus = (email) =>
  request({ url: `token/2fa?email=${encodeURIComponent(email)}`, method: 'GET', auth: false });

export const gen2FAToken = (data) => request({ url: 'token/2fa', method: 'POST', body: data });

export const updateProfile = (data) => request({ url: 'user', method: 'PUT', body: data });
