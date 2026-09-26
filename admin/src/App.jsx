import React from 'react';
import { useTranslation } from 'react-i18next';
import { Provider, useSelector } from 'react-redux';
import { Link, Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router';

import Access from './components/Access.jsx';
import Layout from './components/Layout.jsx';
import Forgot from './pages/forgot/index.jsx';
import Login from './pages/login/index.jsx';
import ManageComments from './pages/manage-comments/index.jsx';
import Thread from './pages/manage-comments/thread.jsx';
import Migration from './pages/migration/index.jsx';
import Profile from './pages/profile/index.jsx';
import User from './pages/user/index.jsx';
import { store } from './store/index.js';

function Home() {
  const user = useSelector((state) => state.user);

  if (!user?.objectId) return <Login />;
  if (user.type !== 'administrator') return <Navigate to="/profile" replace />;

  return <ManageComments />;
}

function Legacy() {
  const location = useLocation();
  const path = location.pathname.replace(/^\/ui(?=\/|$)/u, '') || '/';

  return <Navigate to={`${path}${location.search}`} replace />;
}

function ToLogin() {
  const { search } = useLocation();

  return <Navigate to={`/login${search}`} replace />;
}

function NotFound() {
  const { t } = useTranslation();

  return (
    <Layout narrow>
      <section className="empty-page">
        <h1 className="page-title">404</h1>
        <p>{t('not found tips')}</p>
        <p>
          <Link to="/" className="btn">
            {t('back to home')}
          </Link>
        </p>
      </section>
    </Layout>
  );
}

const admin = (element) => <Access meta={{ auth: 'administrator' }}>{element}</Access>;

export default function App() {
  return (
    <Provider store={store}>
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<ToLogin />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route
            path="/profile"
            element={
              <Access>
                <Profile />
              </Access>
            }
          />
          <Route path="/thread" element={admin(<Thread />)} />
          <Route path="/user" element={admin(<User />)} />
          <Route path="/migration" element={admin(<Migration />)} />
          <Route path="/ui/*" element={<Legacy />} />
          <Route path="/ui" element={<Legacy />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </Provider>
  );
}
