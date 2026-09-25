import cls from 'classnames';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import Layout from '../../components/Layout.jsx';
// oxlint-disable-next-line import/no-namespace
import * as Icons from '../../components/icon';
import Paginator from '../../components/Paginator.jsx';
import { deleteUser, getUserList, updateUser } from '../../services/user.js';
import { SOCIALS, externalLink } from '../../utils/site.js';
import { buildAvatar } from '../manage-comments/utils.js';

export default function User() {
  const currentUser = useSelector((state) => state.user);
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ totalPages: 0, data: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getUserList({ page })
      .then((data) => setList({ totalPages: data.totalPages ?? 0, data: (data.data ?? []).filter(Boolean) }))
      .catch((err) => alert(err.message))
      .finally(() => setLoading(false));
  }, [page]);

  const patchUser = (id, patch) =>
    setList((prev) => ({
      ...prev,
      data: prev.data.map((item) => (item.objectId === id ? { ...item, ...patch } : item)),
    }));

  const actionsFor = (user) =>
    [
      {
        key: 'administrator',
        name: t('set administrator'),
        show: user.type === 'guest',
        async run() {
          await updateUser({ id: user.objectId, type: 'administrator' });
          patchUser(user.objectId, { type: 'administrator' });
        },
      },
      {
        key: 'guest',
        name: t('set guest'),
        show: user.type === 'administrator' || user.type === 'banned',
        async run() {
          if (user.objectId === currentUser.objectId) {
            alert(t("You can't set yourself to be guest!"));
            return;
          }

          await updateUser({ id: user.objectId, type: 'guest' });
          patchUser(user.objectId, { type: 'guest' });
        },
      },
      {
        key: 'label',
        name: t('set label'),
        show: true,
        async run() {
          const label = prompt(t('please enter an exclusive label'), user.label ?? '');

          if (label === null) return;

          await updateUser({ id: user.objectId, label });
          patchUser(user.objectId, { label });
        },
      },
      {
        key: 'delete',
        name: t('delete'),
        show: user.objectId !== currentUser.objectId && user.type !== 'banned',
        async run() {
          if (!confirm(t('delete user confirm'))) return;

          await deleteUser({ id: user.objectId });
          setList((prev) => ({
            ...prev,
            data: user.type.startsWith('verify')
              ? prev.data.filter(({ objectId }) => objectId !== user.objectId)
              : prev.data.map((item) => (item.objectId === user.objectId ? { ...item, type: 'banned' } : item)),
          }));
        },
      },
    ].filter(({ show }) => show);

  const getRole = (type = '') => (type.startsWith('verify') ? t('verify') : t(type));

  return (
    <Layout>
      <div className="page-head">
        <h1 className="page-title">{t('manage users')}</h1>
      </div>

      <ul className={cls('user-list', { 'is-loading': loading })}>
        {!loading && !list.data.length ? <li className="empty">—</li> : null}
        {list.data.map((user) => (
          <li className="user-row" id={`user-${user.objectId}`} key={user.objectId}>
            <img className="avatar" src={buildAvatar(user.email, user.avatar)} alt="" width="40" height="40" loading="lazy" />
            <div className="user-main">
              <div className="comment-meta">
                <strong className="comment-author">
                  {user.url ? (
                    <a href={externalLink(user.url)} rel="external nofollow noreferrer" target="_blank">
                      {user.display_name}
                    </a>
                  ) : (
                    user.display_name
                  )}
                </strong>
                <span className={cls('tag', { 'tag-strong': user.type === 'administrator' })}>
                  {getRole(user.type)}
                </span>
                {user.label ? <span className="tag">{user.label}</span> : null}
              </div>
              <div className="comment-where">
                <a href={`mailto:${user.email}`}>{user.email}</a>
              </div>
              <div className="account-list small">
                {SOCIALS.map((social) => {
                  // oxlint-disable-next-line import/namespace
                  const Icon = Icons[social];

                  if (!Icon) return null;

                  return user[social] && social !== 'oidc' ? (
                    <a
                      key={social}
                      href={`https://${social}.com/${user[social]}`}
                      target="_blank"
                      rel="noreferrer"
                      className={cls('account-item', social, 'bind')}
                      title={social}
                    >
                      <Icon className="social-icon" aria-hidden="true" />
                    </a>
                  ) : (
                    <span
                      key={social}
                      className={cls('account-item', social, { bind: user[social] })}
                      title={social}
                    >
                      <Icon className="social-icon" aria-hidden="true" />
                    </span>
                  );
                })}
              </div>
              <div className="comment-actions">
                {actionsFor(user).map(({ key, name, run }) => (
                  <button
                    type="button"
                    key={key}
                    className={cls('text-btn', `act-${key}`, { danger: key === 'delete' })}
                    onClick={async () => {
                      try {
                        await run();
                      } catch (err) {
                        alert(err.message);
                      }
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Paginator current={page} total={list.totalPages} onChange={setPage} />
    </Layout>
  );
}
