import { forgot, getUserInfo, login, logout, saveToken } from '../services/auth.js';
import { passkeyLogin } from '../services/passkey.js';
import { updateProfile } from '../services/user.js';
import { getToken } from '../utils/site.js';

let sessionExpired = false;

export const takeSessionExpired = () => {
  const expired = sessionExpired;

  sessionExpired = false;

  return expired;
};

const signIn = (dispatch, { token, ...user }, remember) => {
  if (!token || !user.objectId) {
    throw new Error('login failed');
  }

  saveToken(token, remember);
  sessionExpired = false;

  return dispatch.user.setUser(user);
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

      return dispatch.user.setUser(user);
    },
    async login({ email, password, code, remember, recaptchaV3, turnstile }) {
      const data = await login({ email, password, code, recaptchaV3, turnstile });

      return signIn(dispatch, data, remember);
    },
    async passkeyLogin({ response, challengeToken, remember }) {
      const data = await passkeyLogin({ response, challengeToken });

      return signIn(dispatch, data, remember);
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

      return dispatch.user.updateUser(data);
    },
  }),
};
