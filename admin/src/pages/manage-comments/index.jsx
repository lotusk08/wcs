import cls from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import Layout from '../../components/Layout.jsx';
import Paginator from '../../components/Paginator.jsx';
import {
  deleteComment,
  getCommentList,
  replyComment,
  updateComment,
} from '../../services/comment.js';
import { externalLink, resolveContent } from '../../utils/site.js';
import { buildAvatar, formatDate, getPostUrl } from './utils.js';

const STATUSES = ['approved', 'waiting', 'spam'];
const OWNERS = ['all', 'mine'];

function CommentEditor({ comment, onSave, onCancel }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const data = {
      nick: form.nick.value,
      mail: form.mail.value,
      link: form.link.value,
      comment: form.comment.value,
    };

    setSaving(true);
    try {
      await onSave(data);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="comment-editor form" onSubmit={onSubmit}>
      <div className="editor-grid">
        <label className="field">
          <span className="field-label">{t('username')}</span>
          <input className="input" name="nick" type="text" defaultValue={comment.nick} />
        </label>
        <label className="field">
          <span className="field-label">{t('email')}</span>
          <input className="input" name="mail" type="email" defaultValue={comment.mail} />
        </label>
        <label className="field">
          <span className="field-label">{t('homepage')}</span>
          <input className="input" name="link" type="text" defaultValue={comment.link} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">{t('content')}</span>
        <textarea name="comment" rows="6" className="input mono" defaultValue={comment.orig ?? comment.comment} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {t('submit')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

function CommentReply({ onSend, onCancel }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();

    const text = event.currentTarget.text.value;

    if (!text.trim()) return;

    setSending(true);
    try {
      await onSend(text);
    } catch (err) {
      alert(err.message);
      setSending(false);
    }
  };

  return (
    <form className="comment-reply form" onSubmit={onSubmit}>
      <label className="field">
        <span className="sr-only">{t('content')}</span>
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus */}
        <textarea name="text" className="input" rows="3" autoFocus />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {t('reply')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

export default function ManageComments() {
  const { t } = useTranslation();
  const user = useSelector((state) => state.user);
  const [list, setList] = useState({
    page: 1,
    totalPages: 0,
    spamCount: 0,
    waitingCount: 0,
    data: [],
  });
  const [filter, setFilter] = useState({ owner: 'all', status: 'approved', keyword: '' });
  const [loading, setLoading] = useState(true);
  const [handler, setHandler] = useState({});
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const keywordRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCommentList({ page: list.page, filter });

      setList((prev) => ({ ...prev, ...data, data: data.data ?? [] }));
      setSelected([]);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, [filter, list.page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeFilter = (patch) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setList((prev) => ({ ...prev, page: 1 }));
    setHandler({});
  };

  const removeFromList = (comment, { waiting = 0, spam = 0 } = {}) =>
    setList((prev) => ({
      ...prev,
      data: prev.data.filter(({ objectId }) => objectId !== comment.objectId),
      waitingCount: Math.max(0, prev.waitingCount + waiting),
      spamCount: Math.max(0, prev.spamCount + spam),
    }));

  const setStatus = async (comment, status) => {
    await updateComment(comment.objectId, { status });

    const delta = { waiting: 0, spam: 0 };

    if (comment.status === 'waiting') delta.waiting -= 1;
    if (comment.status === 'spam') delta.spam -= 1;
    if (status === 'waiting') delta.waiting += 1;
    if (status === 'spam') delta.spam += 1;

    removeFromList(comment, delta);
  };

  const toggleSticky = async (comment) => {
    const sticky = !comment.sticky;

    await updateComment(comment.objectId, { sticky: sticky ? 1 : 0 });
    setList((prev) => ({
      ...prev,
      data: prev.data.map((item) => (item.objectId === comment.objectId ? { ...item, sticky } : item)),
    }));
  };

  const remove = async (comment) => {
    if (!confirm(t('delete one confirm', { nick: comment.nick }))) return;

    await deleteComment(comment.objectId);
    removeFromList(comment);
  };

  const toggleHandler = (comment, action) =>
    setHandler((prev) =>
      prev.id === comment.objectId && prev.action === action
        ? {}
        : { id: comment.objectId, action },
    );

  const runBulk = async (action) => {
    if (!selected.length) return;
    if (action === 'delete' && !confirm(t('delete multiple confirm'))) return;

    setBusy(true);
    try {
      await Promise.all(
        selected.map((id) =>
          action === 'delete' ? deleteComment(id) : updateComment(id, { status: action }),
        ),
      );
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }

    await load();
  };

  const onReply = async (comment, text) => {
    const { display_name, email, url: link } = user;

    await replyComment({
      nick: display_name,
      mail: email,
      ua: navigator.userAgent,
      link,
      url: comment.url,
      comment: text,
      pid: comment.objectId,
      rid: comment.rid ?? comment.objectId,
      at: comment.nick,
    });
    setHandler({});
    await load();
  };

  const onEdit = async (comment, data) => {
    const { __version, ...saved } = await updateComment(comment.objectId, data);

    if (saved.objectId) {
      setList((prev) => ({
        ...prev,
        data: prev.data.map((item) =>
          item.objectId === comment.objectId ? { ...item, ...saved } : item,
        ),
      }));
    } else {
      await load();
    }
    setHandler({});
  };

  const actionsFor = (comment) =>
    [
      {
        key: 'approved',
        name: t('approved button'),
        show: comment.status !== 'approved',
        run: () => setStatus(comment, 'approved'),
      },
      {
        key: 'waiting',
        name: t('waiting'),
        show: comment.status !== 'waiting',
        run: () => setStatus(comment, 'waiting'),
      },
      {
        key: 'spam',
        name: t('spam'),
        show: comment.status !== 'spam',
        run: () => setStatus(comment, 'spam'),
      },
      {
        key: 'sticky',
        name: comment.sticky ? t('disable sticky') : t('sticky'),
        show: !comment.rid && comment.status === 'approved',
        run: () => toggleSticky(comment),
      },
      {
        key: 'reply',
        name: t('reply'),
        show: comment.status === 'approved',
        run: () => toggleHandler(comment, 'reply'),
      },
      { key: 'edit', name: t('edit'), show: true, run: () => toggleHandler(comment, 'edit') },
      { key: 'delete', name: t('delete'), show: true, run: () => remove(comment) },
    ].filter(({ show }) => show);

  const allSelected =
    list.data.length > 0 && list.data.every(({ objectId }) => selected.includes(objectId));

  const toggleSelected = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  return (
    <Layout>
      <div className="page-head">
        <h1 className="page-title">{t('manage comments')}</h1>
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            changeFilter({ keyword: keywordRef.current.value.trim() });
          }}
        >
          <input
            type="search"
            ref={keywordRef}
            className="input"
            placeholder={t('please input keywords')}
            aria-label={t('please input keywords')}
          />
          <button type="submit" className="btn">
            {t('filter')}
          </button>
        </form>
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="tab"
              aria-selected={filter.status === status}
              className={cls('tab', { active: filter.status === status })}
              onClick={() => changeFilter({ status })}
            >
              {t(status)}
              {status !== 'approved' && list[`${status}Count`] > 0 ? (
                <span className="count">{list[`${status}Count`]}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="segmented">
          {OWNERS.map((owner) => (
            <button
              key={owner}
              type="button"
              aria-pressed={filter.owner === owner}
              className={cls('seg', { active: filter.owner === owner })}
              onClick={() => changeFilter({ owner })}
            >
              {t(owner)}
            </button>
          ))}
        </div>
      </div>

      <div className={cls('bulkbar', { 'has-selection': selected.length > 0 })}>
        <label className="check">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!list.data.length}
            onChange={() =>
              setSelected(allSelected ? [] : list.data.map(({ objectId }) => objectId))
            }
          />
          <span>{selected.length ? selected.length : t('select all')}</span>
        </label>
        <div className="bulk-actions" aria-label={t('selected items')}>
          {filter.status !== 'approved' ? (
            <button type="button" className="text-btn" disabled={!selected.length || busy} onClick={() => runBulk('approved')}>
              {t('approved button')}
            </button>
          ) : null}
          {filter.status !== 'waiting' ? (
            <button type="button" className="text-btn" disabled={!selected.length || busy} onClick={() => runBulk('waiting')}>
              {t('waiting')}
            </button>
          ) : null}
          {filter.status !== 'spam' ? (
            <button type="button" className="text-btn" disabled={!selected.length || busy} onClick={() => runBulk('spam')}>
              {t('mark as spam')}
            </button>
          ) : null}
          <button type="button" className="text-btn danger" disabled={!selected.length || busy} onClick={() => runBulk('delete')}>
            {t('delete')}
          </button>
        </div>
      </div>

      <ul className={cls('comment-list', { 'is-loading': loading })}>
        {!loading && !list.data.length ? <li className="empty">{t('no comments')}</li> : null}
        {list.data.map((comment) => {
          const { objectId, nick, mail, avatar, link, ip, addr, url, sticky, time, insertedAt } =
            comment;
          const editing = handler.id === objectId && handler.action === 'edit';
          const replying = handler.id === objectId && handler.action === 'reply';

          return (
            <li
              key={objectId}
              id={`comment-${objectId}`}
              className={cls('comment', { selected: selected.includes(objectId), sticky })}
            >
              <input
                type="checkbox"
                className="comment-check"
                aria-label={t('select item')}
                checked={selected.includes(objectId)}
                onChange={() => toggleSelected(objectId)}
              />
              <img className="avatar" src={buildAvatar(mail, avatar)} alt="" width="40" height="40" loading="lazy" />
              <div className="comment-main">
                <div className="comment-meta">
                  <strong className="comment-author">
                    {link ? (
                      <a href={externalLink(link)} rel="external nofollow noreferrer" target="_blank">
                        {nick}
                      </a>
                    ) : (
                      nick
                    )}
                  </strong>
                  {sticky ? <span className="tag">{t('sticky')}</span> : null}
                  {mail ? (
                    <a className="muted" href={`mailto:${mail}`}>
                      {mail}
                    </a>
                  ) : null}
                  {ip ? <span className="muted">{ip}</span> : null}
                  {addr ? <span className="muted">{addr}</span> : null}
                </div>
                <div className="comment-where">
                  <time>{formatDate(insertedAt ?? time)}</time> {t('at')}{' '}
                  <a href={getPostUrl(url)} target="_blank" rel="noreferrer">
                    {url}
                  </a>
                </div>

                {editing ? (
                  <CommentEditor
                    comment={comment}
                    onSave={(data) => onEdit(comment, data)}
                    onCancel={() => setHandler({})}
                  />
                ) : (
                  <div
                    className="comment-content"
                    // oxlint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: resolveContent(comment.comment) }}
                  />
                )}

                {replying ? (
                  <CommentReply
                    onSend={(text) => onReply(comment, text)}
                    onCancel={() => setHandler({})}
                  />
                ) : null}

                <div className="comment-actions">
                  {actionsFor(comment).map(({ key, name, run }) => (
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
          );
        })}
      </ul>

      <Paginator
        current={list.page}
        total={list.totalPages}
        onChange={(page) => {
          setList((prev) => ({ ...prev, page }));
          window.scrollTo({ top: 0 });
        }}
      />
    </Layout>
  );
}
