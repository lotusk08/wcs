import { forgot, getUserInfo, login, logout, register } from '../services/auth.js';
import { updateProfile } from '../services/user.js';
import { getToken, postToOpener, storage } from '../utils/site.js';

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
      if (!getToken()) {
        return;
      }

      const user = await getUserInfo();

      if (!user?.objectId) {
        logout();

        return;
      }

      const remember = Boolean(storage.get('localStorage', 'TOKEN'));

      postToOpener({ type: 'userInfo', data: { token: getToken(), remember, ...user } });

      return dispatch.user.setUser(user);
    },
    async login({ email, password, code, remember, recaptchaV3, turnstile }) {
      const { token, ...user } = await login({
        email,
        password,
        code,
        recaptchaV3,
        turnstile,
      });

      if (token) {
        window.TOKEN = token;
        storage.set('sessionStorage', 'TOKEN', token);
        if (remember) {
          storage.set('localStorage', 'TOKEN', token);
        }

        postToOpener({ type: 'userInfo', data: { token, remember, ...user } });
      }

      return dispatch.user.setUser(user);
    },
    logout() {
      logout();
      dispatch.user.setUser(null);
    },
    async register(user) {
      return register(user);
    },
    async forgot(user) {
      return forgot(user);
    },
    async updateProfile(data) {
      await updateProfile(data);

      postToOpener({ type: 'profile', data });

      return dispatch.user.updateUser(data);
    },
  }),
};
