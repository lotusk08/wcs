import cls from 'classnames';
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import AutoTextarea from '../../components/AutoTextarea.jsx';
import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import { deleteComment, replyComment, updateComment } from '../../services/comment.js';
import { resolveContent } from '../../utils/site.js';
import CommentTime from './CommentTime.jsx';
import { CommentSheet, EditSheet } from './sheets.jsx';
import { buildThread, cachedThread, loadThread, storeThread, threadCounts } from './threads.js';
import { commentTime, excerpt, getPostUrl, postPath, postTitle } from './utils.js';

const isOwn = (comment, user) =>
  comment.type === 'administrator' ||
  Boolean(user?.objectId && comment.user_id && String(comment.user_id) === String(user.objectId)) ||
  Boolean(user?.email && comment.mail && comment.mail === user.email);

const Bubble = memo(function Bubble({ comment, parent, own, reply, flash, onReply, onMore, onApprove, onJump }) {
  const { t } = useTranslation();
  const { objectId, nick, status, sticky } = comment;
  const html = useMemo(() => resolveContent(comment.comment), [comment.comment]);

  return (
    <article
      id={`c-${objectId}`}
      className={cls('bubble-row', `is-${status || 'approved'}`, { 'is-own': own, 'is-reply': reply, 'is-flash': flash })}
    >
      {own ? null : <Avatar src={comment.avatar} size={32} className="bubble-avatar" />}
      <div className="bubble-main">
        <div className="bubble">
          <div className="bubble-head">
            <strong className="bubble-nick">{nick}</strong>
            {own ? <span className="tag tag-strong">{t('author tag')}</span> : null}
            {status === 'waiting' ? <span className="tag tag-waiting">{t('waiting')}</span> : null}
            {status === 'spam' ? <span className="tag tag-danger">{t('spam')}</span> : null}
            {sticky ? (
              <span className="tag tag-pin">
                <Icon name="pin" size={12} />
                {t('pinned')}
              </span>
            ) : null}
            <CommentTime value={comment.insertedAt ?? comment.time} />
          </div>
          {parent ? (
            <button type="button" className="bubble-to" onClick={() => onJump(parent.objectId)}>
              <span aria-hidden="true">↪</span>
              <span className="bubble-to-text">{t('replying to @{{nick}}', { nick: parent.nick })}</span>
            </button>
          ) : null}
          {/* oxlint-disable-next-line react/no-danger */}
          <div className="comment-content bubble-content" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <div className="bubble-actions">
          {status === 'approved' || !status ? (
            <button type="button" className="bubble-act act-reply" onClick={() => onReply(comment)}>
              <Icon name="reply" size={16} />
              <span>{t('reply')}</span>
            </button>
          ) : (
            <button type="button" className="bubble-act act-approved" onClick={() => onApprove(comment)}>
              <Icon name="check" size={16} />
              <span>{t('approve')}</span>
            </button>
          )}
          <button
            type="button"
            className="bubble-act act-more"
            aria-haspopup="dialog"
            aria-label={`${t('more actions')}: ${nick}`}
            onClick={() => onMore(comment)}
          >
            <Icon name="more" size={18} />
          </button>
        </div>
      </div>
    </article>
  );
});

function Skeleton() {
  return (
    <ol className="thread" aria-hidden="true">
      {[0, 1, 2].map((key) => (
        <li key={key} className={cls('thread-group', 'bubble-skeleton', { 'is-own': key === 1 })}>
          <span className="sk sk-avatar" />
          <span className="sk-bubble">
            <span className="sk sk-line sk-short" />
            <span className="sk sk-line" />
            <span className="sk sk-line sk-mid" />
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function Thread() {
  const { t } = useTranslation();
  const user = useSelector((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const path = params.get('path') ?? '';
  const focus = params.get('focus') ?? '';
  const [comments, setComments] = useState(() => cachedThread(path));
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null);
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');
  const [sheet, setSheet] = useState({ type: null, comment: null, seq: 0 });
  const [sheetOpen, setSheetOpen] = useState(false);
  const pageRef = useRef(null);
  const formRef = useRef(null);
  const scrolled = useRef(false);
  const pending = useRef('');

  const fail = (err) => setNotice(err?.message || String(err));

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setFailed(false);
    try {
      setComments(await loadThread(path));
    } catch (err) {
      setFailed(true);
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    scrolled.current = false;
    setComments(cachedThread(path));
    setTarget(null);
    load();
  }, [path, load]);

  useEffect(() => {
    if (comments && path) storeThread(path, comments);
  }, [comments, path]);

  useLayoutEffect(() => {
    const composer = formRef.current;
    const page = pageRef.current;

    if (!composer || !page || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      page.style.setProperty('--composer-h', `${composer.offsetHeight}px`);
    });

    observer.observe(composer);

    return () => observer.disconnect();
  }, []);

  const groups = useMemo(() => buildThread(comments ?? []), [comments]);
  const counts = useMemo(() => threadCounts(comments ?? []), [comments]);

  const jump = useCallback((id, smooth = true) => {
    const el = document.getElementById(`c-${id}`);

    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    setFlash('');
    requestAnimationFrame(() => setFlash(String(id)));

    return true;
  }, []);

  useEffect(() => {
    if (!comments || scrolled.current) return;

    const found = Boolean(focus) && comments.some(({ objectId }) => String(objectId) === focus);

    if (focus && !found && loading) return;

    scrolled.current = true;
    requestAnimationFrame(() => {
      if (found) {
        jump(focus, false);

        return;
      }

      const newest = comments.reduce((best, item) => (!best || commentTime(item) >= commentTime(best) ? item : best), null);
      const el = newest && document.getElementById(`c-${newest.objectId}`);
      const rows = document.querySelectorAll('.thread .bubble-row');

      if (!el || el === rows[rows.length - 1]) {
        window.scrollTo({ top: document.documentElement.scrollHeight });
      } else {
        el.scrollIntoView({ block: 'center' });
      }
    });
  }, [comments, focus, loading, jump]);

  useEffect(() => {
    if (!pending.current || !comments) return;

    const id = pending.current;

    pending.current = '';
    requestAnimationFrame(() => jump(id));
  }, [comments, jump]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(''), 2400);

    return () => clearTimeout(timer);
  }, [flash]);

  const patch = (id, data) =>
    setComments((prev) => (prev ?? []).map((item) => (item.objectId === id ? { ...item, ...data } : item)));

  const closeSheet = () => setSheetOpen(false);

  const openSheet = useCallback((type, comment) => {
    setSheet((prev) => ({ type, comment, seq: prev.seq + 1 }));
    setSheetOpen(true);
  }, []);

  const pick = useCallback((comment) => {
    setSheetOpen(false);
    setTarget(comment);
    requestAnimationFrame(() => formRef.current?.text?.focus({ preventScroll: true }));
  }, []);

  const setStatus = useCallback(async (comment, status) => {
    setSheetOpen(false);
    setComments((prev) => (prev ?? []).map((item) => (item.objectId === comment.objectId ? { ...item, status } : item)));
    if (status !== 'approved') setTarget((prev) => (prev?.objectId === comment.objectId ? null : prev));
    try {
      await updateComment(comment.objectId, { status });
    } catch (err) {
      setComments((prev) =>
        (prev ?? []).map((item) => (item.objectId === comment.objectId ? { ...item, status: comment.status } : item)),
      );
      setNotice(err?.message || String(err));
    }
  }, []);

  const approve = useCallback((comment) => setStatus(comment, 'approved'), [setStatus]);
  const more = useCallback((comment) => openSheet('more', comment), [openSheet]);

  const toggleSticky = async (comment) => {
    const sticky = !comment.sticky;

    closeSheet();
    patch(comment.objectId, { sticky });
    try {
      await updateComment(comment.objectId, { sticky: sticky ? 1 : 0 });
    } catch (err) {
      patch(comment.objectId, { sticky: comment.sticky });
      fail(err);
    }
  };

  const remove = async (comment) => {
    const id = comment.objectId;

    closeSheet();
    const gone = (item) => [item.objectId, item.pid, item.rid].some((value) => value != null && String(value) === String(id));

    setComments((prev) => (prev ?? []).filter((item) => !gone(item)));
    setTarget((prev) => (prev && gone(prev) ? null : prev));
    try {
      await deleteComment(id);
    } catch (err) {
      fail(err);
      await load();
    }
  };

  const onEdit = async (comment, data) => {
    let saved;

    try {
      const { __version, ...rest } = await updateComment(comment.objectId, data);

      saved = rest;
    } catch (err) {
      fail(err);
      throw err;
    }

    patch(comment.objectId, saved.objectId ? { ...saved, url: comment.url } : data);
    closeSheet();
  };

  const send = async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const text = form.text.value;

    if (!target || !text.trim() || sending) return;

    setSending(true);
    try {
      const { __version, ...saved } = await replyComment({
        nick: user.display_name,
        mail: user.email,
        ua: navigator.userAgent,
        link: user.url,
        url: target.url ?? path,
        comment: text,
        pid: target.objectId,
        rid: target.rid || target.objectId,
        at: target.nick,
      });
      const added = {
        ...saved,
        url: saved.url ?? path,
        pid: saved.pid ?? target.objectId,
        rid: saved.rid ?? (target.rid || target.objectId),
        type: saved.type ?? user.type,
      };

      form.reset();
      form.text.style.height = '';
      pending.current = added.objectId;
      setComments((prev) => [...(prev ?? []), added]);
      setTarget(null);
    } catch (err) {
      fail(err);
    } finally {
      setSending(false);
    }
  };

  const back = () => {
    if (location.key && location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/?view=posts');
    }
  };

  const actionsFor = (comment) =>
    [
      {
        key: 'reply',
        name: t('reply'),
        icon: 'reply',
        show: comment.status === 'approved' || !comment.status,
        run: () => pick(comment),
      },
      comment.status === 'approved' || !comment.status
        ? { key: 'waiting', name: t('hide'), icon: 'hide', show: true, run: () => setStatus(comment, 'waiting') }
        : { key: 'approved', name: t('approve'), icon: 'check', show: true, run: () => setStatus(comment, 'approved') },
      {
        key: 'spam',
        name: t('mark as spam'),
        icon: 'spam',
        show: comment.status !== 'spam',
        run: () => setStatus(comment, 'spam'),
      },
      {
        key: 'waiting',
        name: t('not spam'),
        icon: 'shield',
        show: comment.status === 'spam',
        run: () => setStatus(comment, 'waiting'),
      },
      {
        key: 'sticky',
        name: comment.sticky ? t('unpin') : t('pin'),
        icon: 'pin',
        show: !comment.rid && comment.status === 'approved',
        run: () => toggleSticky(comment),
      },
      { key: 'edit', name: t('edit'), icon: 'edit', show: true, run: () => openSheet('edit', comment) },
      { key: 'delete', name: t('delete'), icon: 'trash', show: true, run: () => remove(comment) },
    ].filter(({ show }) => show);

  const live = comments?.find(({ objectId }) => objectId === sheet.comment?.objectId) ?? sheet.comment;
  const title = path ? postTitle(path) : t('conversation');

  const bubble = (comment, parent, reply) => (
    <Bubble
      comment={comment}
      parent={parent}
      reply={reply}
      own={isOwn(comment, user)}
      flash={flash === String(comment.objectId)}
      onReply={pick}
      onMore={more}
      onApprove={approve}
      onJump={jump}
    />
  );

  return (
    <Layout className="thread-page">
      <div ref={pageRef} className="thread-wrap">
        <Notice floating onClose={() => setNotice('')}>{notice}</Notice>

        <header className="thread-head">
          <button type="button" className="icon-btn thread-back" aria-label={t('back')} onClick={back}>
            <Icon name="prev" size={22} />
          </button>
          <div className="thread-heading">
            <h1 className="thread-title">{title}</h1>
            {path ? (
              <a className="thread-link" href={getPostUrl(path)} target="_blank" rel="noreferrer" title={t('open post')}>
                <span>{postPath(path)}</span>
                <Icon name="external" size={14} />
              </a>
            ) : null}
          </div>
        </header>

        {comments?.length ? (
          <p className="thread-stats" aria-live="polite">
            <span className="stat">
              <Icon name="comments" size={14} />
              {t('{{count}} comments', { count: counts.total })}
            </span>
            {counts.waiting ? <span className="stat stat-waiting">{t('{{count}} waiting', { count: counts.waiting })}</span> : null}
            {counts.spam ? <span className="stat stat-spam">{t('{{count}} spam', { count: counts.spam })}</span> : null}
          </p>
        ) : null}

        <div className={cls('thread-body', { 'is-loading': loading && Boolean(comments?.length) })} aria-busy={loading}>
          {!path ? (
            <div className="empty">
              <Icon name="comments" size={36} />
              <p>{t('no post selected')}</p>
              <Link to="/?view=posts" className="btn">
                {t('by post')}
              </Link>
            </div>
          ) : null}
          {path && !comments && loading ? <Skeleton /> : null}
          {path && !comments && failed ? (
            <div className="empty">
              <Icon name="inbox" size={36} />
              <p>{t('could not load')}</p>
              <button type="button" className="btn" onClick={load}>
                {t('retry')}
              </button>
            </div>
          ) : null}
          {path && comments && !comments.length ? (
            <div className="empty">
              <Icon name="inbox" size={36} />
              <p>{t('no comments')}</p>
            </div>
          ) : null}
          {groups.length ? (
            <ol className="thread">
              {groups.map(({ root, replies }) => (
                <li key={root.objectId} className="thread-group">
                  {bubble(root, null, false)}
                  {replies.length ? (
                    <ol className="thread-replies">
                      {replies.map(({ comment, parent }) => (
                        <li key={comment.objectId}>{bubble(comment, parent, true)}</li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <form ref={formRef} className={cls('composer', { 'has-target': Boolean(target) })} onSubmit={send}>
          <div className="composer-inner">
            {target ? (
              <div className="composer-target">
                <button type="button" className="composer-target-text" onClick={() => jump(target.objectId)}>
                  <Icon name="reply" size={16} />
                  <span className="composer-target-copy">
                    <strong>{t('replying to @{{nick}}', { nick: target.nick })}</strong>
                    <span>{excerpt(target.comment, 90)}</span>
                  </span>
                </button>
                <button type="button" className="icon-btn composer-clear" aria-label={t('cancel reply')} onClick={() => setTarget(null)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
            ) : null}
            <div className="composer-row">
              <label className="composer-field">
                <span className="sr-only">{t('content')}</span>
                <AutoTextarea
                  name="text"
                  rows="1"
                  className="input compose composer-input"
                  placeholder={target ? t('write a reply') : t('pick a comment to reply')}
                  disabled={!target}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
              </label>
              <button
                type="submit"
                className="btn btn-primary btn-solid composer-send"
                aria-label={t('send')}
                title={t('send')}
                disabled={!target || sending}
              >
                <Icon name="send" size={20} />
              </button>
            </div>
          </div>
        </form>
      </div>

      <CommentSheet
        open={sheetOpen && sheet.type === 'more'}
        comment={live}
        actions={live ? actionsFor(live) : []}
        onClose={closeSheet}
        onError={setNotice}
      />
      <EditSheet
        open={sheetOpen && sheet.type === 'edit'}
        comment={live}
        seq={sheet.seq}
        onSave={(data) => onEdit(sheet.comment, data)}
        onClose={closeSheet}
      />
    </Layout>
  );
}
