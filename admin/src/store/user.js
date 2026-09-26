import { forgot, getUserInfo, login, logout, saveToken } from '../services/auth.js';
import { updateProfile } from '../services/user.js';
import { getToken, postToOpener, publicUser, storage } from '../utils/site.js';

let sessionExpired = false;

export const takeSessionExpired = () => {
  const expired = sessionExpired;

  sessionExpired = false;

  return expired;
};

export const user = {
  state: null,
  reducers: {
    setUser(_, user) {
      return user;
    },
    updateUser(state, data) {
      return { ...state, ...data };
    },
  },
  effects: (dispatch) => ({
    async loadUserInfo() {
      const token = getToken();

      if (!token) {
        return;
      }

      let user;

      try {
        user = await getUserInfo();
      } catch (err) {
        if (err?.errno === 'network' || err?.status >= 500) return;
        user = null;
      }

      if (!user?.objectId) {
        logout();
        sessionExpired = true;

        return;
      }

      const remember = storage.get('localStorage', 'TOKEN') === token;

      postToOpener({ type: 'userInfo', data: { ...publicUser(user), token, remember } });

      return dispatch.user.setUser(user);
    },
    async login({ email, password, code, remember, recaptchaV3, turnstile }) {
      const { token, ...user } = await login({ email, password, code, recaptchaV3, turnstile });

      if (!token || !user.objectId) {
        throw new Error('login failed');
      }

      saveToken(token, remember);
      sessionExpired = false;
      postToOpener({ type: 'userInfo', data: { ...publicUser(user), token, remember } });

      return dispatch.user.setUser(user);
    },
    logout() {
      logout();
      dispatch.user.setUser(null);
    },
    async forgot(user) {
      return forgot(user);
    },
    async updateProfile(data) {
      await updateProfile(data);

      postToOpener({ type: 'profile', data: publicUser(data) });

      return dispatch.user.updateUser(data);
    },
  }),
};
