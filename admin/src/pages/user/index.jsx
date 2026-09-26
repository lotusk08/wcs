import cls from 'classnames';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import Avatar from '../../components/Avatar.jsx';
import BottomSheet from '../../components/BottomSheet.jsx';
import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import Paginator from '../../components/Paginator.jsx';
import { deleteUser, getUserList, updateUser } from '../../services/user.js';
import { externalLink } from '../../utils/site.js';

function UserSheet({ open, user, actions, onClose, onLabel }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(null);
      setSaving(false);
    }
  }, [open, user?.objectId]);

  if (!user) return <BottomSheet open={false} onClose={onClose} />;

  const remove = actions.find(({ key }) => key === 'delete');
  const header = (
    <div className="sheet-account">
      <Avatar src={user.avatar} size={44} className="sheet-avatar" />
      <div className="sheet-heading">
        <h2 className="sheet-title">{user.display_name}</h2>
        <p className="sheet-subtitle">{user.email}</p>
      </div>
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} header={header} className="user-sheet">
      {mode === 'label' ? (
        <form
          className="form label-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            try {
              await onLabel(event.currentTarget.label.value);
            } catch {
              setSaving(false);
            }
          }}
        >
          <label className="field">
            <span className="field-label">{t('please enter an exclusive label')}</span>
            <input name="label" type="text" className="input" defaultValue={user.label ?? ''} autoComplete="off" data-autofocus />
          </label>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => setMode(null)}>
              {t('cancel')}
            </button>
            <button type="submit" className="btn btn-primary btn-solid act-label-save" disabled={saving}>
              <Icon name="check" size={18} />
              {t('save')}
            </button>
          </div>
        </form>
      ) : mode === 'delete' && remove ? (
        <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-user-text">
          <p id="confirm-user-text">{t('delete user confirm')}</p>
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => setMode(null)}>
              {t('cancel')}
            </button>
            <button type="button" className="btn btn-danger btn-solid act-delete-confirm" data-autofocus onClick={remove.run}>
              <Icon name="trash" size={18} />
              {t('delete')}
            </button>
          </div>
        </div>
      ) : (
        <div className="sheet-actions">
          {actions.map(({ key, name, icon, run }) => (
            <button
              type="button"
              key={key}
              className={cls('sheet-item', `act-${key}`, { danger: key === 'delete' })}
              onClick={key === 'delete' || key === 'label' ? () => setMode(key) : run}
            >
              <Icon name={icon} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

export default function User() {
  const currentUser = useSelector((state) => state.user);
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [list, setList] = useState({ totalPages: 0, data: [] });
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    getUserList({ page })
      .then((data) => setList({ totalPages: data.totalPages ?? 0, data: (data.data ?? []).filter(Boolean) }))
      .catch((err) => setNotice(err.message))
      .finally(() => {
        setLoading(false);
        setLoaded(true);
      });
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
        icon: 'shield',
        show: user.type === 'guest',
        async run() {
          setOpen(false);
          await updateUser({ id: user.objectId, type: 'administrator' });
          patchUser(user.objectId, { type: 'administrator' });
        },
      },
      {
        key: 'guest',
        name: t('set guest'),
        icon: 'profile',
        show: user.type === 'administrator' || user.type === 'banned',
        async run() {
          setOpen(false);
          if (user.objectId === currentUser.objectId) {
            setNotice(t("You can't set yourself to be guest!"));
            return;
          }

          await updateUser({ id: user.objectId, type: 'guest' });
          patchUser(user.objectId, { type: 'guest' });
        },
      },
      {
        key: 'label',
        name: t('set label'),
        icon: 'tag',
        show: true,
        run() {},
      },
      {
        key: 'delete',
        name: t('delete'),
        icon: 'trash',
        show: user.objectId !== currentUser.objectId && user.type !== 'banned',
        async run() {
          setOpen(false);
          await deleteUser({ id: user.objectId });
          setList((prev) => ({
            ...prev,
            data: user.type.startsWith('verify')
              ? prev.data.filter(({ objectId }) => objectId !== user.objectId)
              : prev.data.map((item) => (item.objectId === user.objectId ? { ...item, type: 'banned' } : item)),
          }));
        },
      },
    ]
      .filter(({ show }) => show)
      .map((action) => ({
        ...action,
        async run() {
          try {
            await action.run();
          } catch (err) {
            setNotice(err.message);
          }
        },
      }));

  const getRole = (type = '') => (type.startsWith('verify') ? t('verify') : t(type));
  const live = target ? (list.data.find(({ objectId }) => objectId === target.objectId) ?? target) : null;

  return (
    <Layout title={t('manage users')}>
      <Notice onClose={() => setNotice('')}>{notice}</Notice>

      <ul className={cls('user-list', { 'is-loading': loading })} aria-busy={loading}>
        {loading && !loaded
          ? [0, 1, 2].map((key) => (
              <li key={key} className="comment-skeleton" aria-hidden="true">
                <span className="sk sk-avatar" />
                <span className="sk sk-line sk-short" />
                <span className="sk sk-line sk-mid" />
              </li>
            ))
          : null}
        {loaded && !loading && !list.data.length ? (
          <li className="empty">
            <Icon name="users" size={36} />
            <p>{t('no users')}</p>
          </li>
        ) : null}
        {list.data.map((user) => (
          <li className={cls('user-row', { banned: user.type === 'banned' })} id={`user-${user.objectId}`} key={user.objectId}>
            <Avatar src={user.avatar} size={40} className="user-avatar" />
            <div className="user-main">
              <div className="user-name-row">
                <strong className="comment-author">
                  {user.url ? (
                    <a href={externalLink(user.url)} rel="external nofollow noreferrer" target="_blank">
                      {user.display_name}
                    </a>
                  ) : (
                    user.display_name
                  )}
                </strong>
                <span className={cls('tag', { 'tag-strong': user.type === 'administrator', 'tag-danger': user.type === 'banned' })}>
                  {getRole(user.type)}
                </span>
                {user.label ? <span className="tag">{user.label}</span> : null}
              </div>
              <div className="user-email">
                <a href={`mailto:${user.email}`}>{user.email}</a>
              </div>
            </div>
            <button
              type="button"
              className="icon-btn act-more"
              aria-haspopup="dialog"
              aria-label={`${t('more actions')}: ${user.display_name}`}
              onClick={() => {
                setTarget(user);
                setOpen(true);
              }}
            >
              <Icon name="more" />
            </button>
          </li>
        ))}
      </ul>

      <Paginator current={page} total={list.totalPages} onChange={setPage} />

      <UserSheet
        open={open}
        user={live}
        actions={live ? actionsFor(live) : []}
        onClose={() => setOpen(false)}
        onLabel={async (label) => {
          try {
            await updateUser({ id: live.objectId, label });
          } catch (err) {
            setNotice(err.message);
            throw err;
          }
          patchUser(live.objectId, { label });
          setOpen(false);
        }}
      />
    </Layout>
  );
}
