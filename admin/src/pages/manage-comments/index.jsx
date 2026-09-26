import cls from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Link, useNavigate, useSearchParams } from 'react-router';

import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/icon/ui.jsx';
import Layout from '../../components/Layout.jsx';
import Notice from '../../components/Notice.jsx';
import Paginator from '../../components/Paginator.jsx';
import {
  deleteComment,
  getCommentList,
  replyComment,
  updateComment,
} from '../../services/comment.js';
import { externalLink, resolveContent } from '../../utils/site.js';
import CommentTime from './CommentTime.jsx';
import PostsView from './posts.jsx';
import { CommentSheet, EditSheet, ReplySheet } from './sheets.jsx';
import { threadLink } from './threads.js';
import { hasRegion, postPath } from './utils.js';

const STATUSES = ['approved', 'waiting', 'spam'];
const OWNERS = ['all', 'mine'];

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
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [sheet, setSheet] = useState({ type: null, seq: 0 });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState([]);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const keywordRef = useRef(null);
  const byPost = params.get('view') === 'posts';

  const fail = (err) => setNotice(err?.message || String(err));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCommentList({ page: list.page, filter });

      setList((prev) => ({ ...prev, ...data, data: data.data ?? [] }));
      setSelected([]);
      setConfirmBulk(false);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [filter, list.page]);

  useEffect(() => {
    if (!byPost) load();
  }, [load, byPost]);

  useEffect(() => {
    if (searching) keywordRef.current?.focus();
  }, [searching]);

  const changeFilter = (patch) => {
    setFilter((prev) => ({ ...prev, ...patch }));
    setList((prev) => ({ ...prev, page: 1 }));
    setSheetOpen(false);
  };

  const showPosts = () => {
    setSelecting(false);
    setSelected([]);
    setConfirmBulk(false);
    setSearching(false);
    setSheetOpen(false);
    setParams({ view: 'posts' });
  };

  const showList = (owner) => {
    if (owner !== filter.owner) changeFilter({ owner });
    if (byPost) setParams({});
  };

  const openSheet = (type, comment) => {
    setSheet((prev) => ({ ...prev, type, [type]: comment, seq: prev.seq + 1 }));
    setSheetOpen(true);
  };

  const closeSheet = () => setSheetOpen(false);

  const removeFromList = (comment, { waiting = 0, spam = 0 } = {}) =>
    setList((prev) => ({
      ...prev,
      data: prev.data.filter(({ objectId }) => objectId !== comment.objectId),
      waitingCount: Math.max(0, prev.waitingCount + waiting),
      spamCount: Math.max(0, prev.spamCount + spam),
    }));

  const setStatus = async (comment, status) => {
    const delta = { waiting: 0, spam: 0 };

    if (comment.status === 'waiting') delta.waiting -= 1;
    if (comment.status === 'spam') delta.spam -= 1;
    if (status === 'waiting') delta.waiting += 1;
    if (status === 'spam') delta.spam += 1;

    closeSheet();
    removeFromList(comment, delta);
    try {
      await updateComment(comment.objectId, { status });
    } catch (err) {
      fail(err);
      await load();
    }
  };

  const patchComment = (id, patch) =>
    setList((prev) => ({
      ...prev,
      data: prev.data.map((item) => (item.objectId === id ? { ...item, ...patch } : item)),
    }));

  const toggleSticky = async (comment) => {
    const sticky = !comment.sticky;

    closeSheet();
    patchComment(comment.objectId, { sticky });
    try {
      await updateComment(comment.objectId, { sticky: sticky ? 1 : 0 });
    } catch (err) {
      patchComment(comment.objectId, { sticky: comment.sticky });
      fail(err);
    }
  };

  const remove = async (comment) => {
    closeSheet();
    removeFromList(comment, {
      waiting: comment.status === 'waiting' ? -1 : 0,
      spam: comment.status === 'spam' ? -1 : 0,
    });
    try {
      await deleteComment(comment.objectId);
    } catch (err) {
      fail(err);
      await load();
    }
  };

  const runBulk = async (action) => {
    if (!selected.length) return;

    setBusy(true);
    try {
      await Promise.all(
        selected.map((id) =>
          action === 'delete' ? deleteComment(id) : updateComment(id, { status: action }),
        ),
      );
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }

    await load();
  };

  const onReply = async (comment, text) => {
    const { display_name, email, url: link } = user;

    try {
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
    } catch (err) {
      fail(err);
      throw err;
    }
    closeSheet();
    await load();
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

    if (saved.objectId) {
      patchComment(comment.objectId, saved);
    } else {
      await load();
    }
    closeSheet();
  };

  const primaryFor = (comment) => {
    const actions = [
      comment.status === 'approved'
        ? { key: 'waiting', name: t('hide'), icon: 'hide', run: () => setStatus(comment, 'waiting') }
        : { key: 'approved', name: t('approve'), icon: 'check', run: () => setStatus(comment, 'approved') },
    ];

    if (comment.status === 'approved') {
      actions.push({ key: 'reply', name: t('reply'), icon: 'reply', run: () => openSheet('reply', comment) });
    } else if (comment.status === 'waiting') {
      actions.push({ key: 'spam', name: t('spam'), icon: 'spam', run: () => setStatus(comment, 'spam') });
    }

    return actions;
  };

  const moreFor = (comment) =>
    [
      {
        key: 'thread',
        name: t('view conversation'),
        icon: 'comments',
        show: true,
        run: () => navigate(threadLink(comment.url, comment.objectId)),
      },
      {
        key: 'spam',
        name: t('mark as spam'),
        icon: 'spam',
        show: comment.status === 'approved',
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

  const allSelected =
    list.data.length > 0 && list.data.every(({ objectId }) => selected.includes(objectId));

  const toggleSelected = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));

  const stopSelecting = () => {
    setSelecting(false);
    setSelected([]);
    setConfirmBulk(false);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    changeFilter({ keyword: keywordRef.current.value.trim() });
  };

  const closeSearch = () => {
    setSearching(false);
    if (filter.keyword) {
      keywordRef.current.value = '';
      changeFilter({ keyword: '' });
    }
  };

  const live = (type) => {
    const comment = sheet[type];

    return list.data.find(({ objectId }) => objectId === comment?.objectId) ?? comment ?? null;
  };
  const moreTarget = live('more');

  const bulkActions = [
    { key: 'approved', name: t('approve'), icon: 'check', show: filter.status !== 'approved' },
    { key: 'waiting', name: t('hide'), icon: 'hide', show: filter.status === 'approved' },
    { key: 'spam', name: t('spam'), icon: 'spam', show: filter.status !== 'spam' },
    { key: 'waiting', name: t('not spam'), icon: 'shield', show: filter.status === 'spam' },
  ].filter(({ show }) => show);

  return (
    <Layout title={t('manage comments')} className={cls('manage', { 'is-selecting': selecting })}>
      <Notice floating onClose={() => setNotice('')}>{notice}</Notice>

      {byPost ? null : (
        <div className="subbar">
          <div className="tabs" role="tablist" aria-label={t('status')}>
            {STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={filter.status === status}
                className={cls('tab', { active: filter.status === status })}
                onClick={() => changeFilter({ status })}
              >
                <span className="tab-label">{t(status)}</span>
                {status !== 'approved' && list[`${status}Count`] > 0 ? (
                  <span className="count">{list[`${status}Count`]}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={cls('filterbar', { searching: searching && !byPost, 'by-post': byPost })}>
        <div className="segmented" role="group" aria-label={t('view')}>
          {OWNERS.map((owner) => (
            <button
              key={owner}
              type="button"
              aria-pressed={!byPost && filter.owner === owner}
              className={cls('seg', { active: !byPost && filter.owner === owner })}
              onClick={() => showList(owner)}
            >
              {t(owner)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={byPost}
            className={cls('seg', 'seg-posts', { active: byPost })}
            onClick={showPosts}
          >
            {t('by post')}
          </button>
        </div>

        <form className="search" role="search" onSubmit={submitSearch}>
          <Icon name="search" size={18} className="search-icon" />
          <input
            type="search"
            ref={keywordRef}
            className="input"
            enterKeyHint="search"
            placeholder={t('please input keywords')}
            aria-label={t('please input keywords')}
          />
          <button type="submit" className="btn">
            {t('filter')}
          </button>
        </form>

        <div className="filterbar-tools">
          <button
            type="button"
            className={cls('icon-btn', 'search-toggle', { active: searching })}
            aria-label={searching ? t('close search') : t('search')}
            aria-expanded={searching}
            onClick={() => (searching ? closeSearch() : setSearching(true))}
          >
            <Icon name={searching ? 'close' : 'search'} />
          </button>
          <button
            type="button"
            className={cls('btn', 'btn-quiet', 'act-select', { active: selecting })}
            aria-pressed={selecting}
            disabled={!list.data.length && !selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            <Icon name="select" size={18} />
            <span>{selecting ? t('done') : t('select')}</span>
          </button>
        </div>
      </div>

      {filter.keyword && !searching && !byPost ? (
        <div className="keyword-chip">
          <Icon name="search" size={16} />
          <span className="keyword-text">{filter.keyword}</span>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('clear search')}
            onClick={() => {
              keywordRef.current.value = '';
              changeFilter({ keyword: '' });
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}

      {byPost ? (
        <PostsView onError={setNotice} />
      ) : (
        <>
          <ul className={cls('comment-list', { 'is-loading': loading })} aria-busy={loading}>
            {loading && !loaded
              ? [0, 1, 2].map((key) => (
                  <li key={key} className="comment-skeleton" aria-hidden="true">
                    <span className="sk sk-avatar" />
                    <span className="sk sk-line sk-short" />
                    <span className="sk sk-line" />
                    <span className="sk sk-line sk-mid" />
                  </li>
                ))
              : null}
            {loaded && !loading && !list.data.length ? (
              <li className="empty">
                <Icon name="inbox" size={36} />
                <p>{t('no comments')}</p>
              </li>
            ) : null}
            {list.data.map((comment) => {
              const { objectId, nick, mail, link, ip, addr, url, sticky, time, insertedAt } = comment;
              const isSelected = selected.includes(objectId);

              return (
                <li
                  key={objectId}
                  id={`comment-${objectId}`}
                  className={cls('comment', { selected: isSelected, sticky })}
                  onClick={
                    selecting
                      ? (event) => {
                          if (event.target.closest('.comment-select')) return;
                          event.preventDefault();
                          toggleSelected(objectId);
                        }
                      : undefined
                  }
                >
                  {selecting ? (
                    <label className="comment-select">
                      <input
                        type="checkbox"
                        className="comment-check"
                        checked={isSelected}
                        onChange={() => toggleSelected(objectId)}
                      />
                      <span className="sr-only">
                        {t('select item')}: {nick}
                      </span>
                    </label>
                  ) : null}
                  <div className="comment-body">
                    <div className="comment-head">
                      <Avatar src={comment.avatar} size={32} className="comment-avatar" />
                      <div className="comment-who">
                        <strong className="comment-author">
                          {link && !selecting ? (
                            <a href={externalLink(link)} rel="external nofollow noreferrer" target="_blank">
                              {nick}
                            </a>
                          ) : (
                            nick
                          )}
                        </strong>
                        {sticky ? (
                          <span className="tag tag-pin">
                            <Icon name="pin" size={12} />
                            {t('pinned')}
                          </span>
                        ) : null}
                        <span className="comment-extra">
                          {[mail, ip, hasRegion(addr) ? addr : ''].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <CommentTime value={insertedAt ?? time} />
                    </div>

                    {selecting ? (
                      <span className="post-chip">
                        <span>{postPath(url)}</span>
                      </span>
                    ) : (
                      <Link className="post-chip" to={threadLink(url, objectId)} title={t('view conversation')}>
                        <Icon name="comments" size={14} />
                        <span>{postPath(url)}</span>
                      </Link>
                    )}

                    <div
                      className="comment-content"
                      // oxlint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={{ __html: resolveContent(comment.comment) }}
                    />

                    {selecting ? null : (
                      <div className="comment-actions">
                        {primaryFor(comment).map(({ key, name, icon, run }) => (
                          <button type="button" key={key} className={cls('act', `act-${key}`)} onClick={run}>
                            <Icon name={icon} size={18} />
                            <span>{name}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="act act-more"
                          aria-haspopup="dialog"
                          aria-label={`${t('more actions')}: ${nick}`}
                          onClick={() => openSheet('more', comment)}
                        >
                          <Icon name="more" size={18} />
                          <span aria-hidden="true">{t('more')}</span>
                        </button>
                      </div>
                    )}
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

          {selecting ? (
            <div className="bulkbar" role="region" aria-label={t('selected items')}>
              {confirmBulk ? (
                <div className="bulk-confirm" role="alertdialog" aria-labelledby="bulk-confirm-text">
                  <p id="bulk-confirm-text">
                    {t('delete multiple confirm')} ({selected.length}) {t('cannot be undone')}
                  </p>
                  <div className="bulk-actions">
                    <button type="button" className="btn" onClick={() => setConfirmBulk(false)}>
                      {t('cancel')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-solid act-delete-confirm"
                      disabled={busy}
                      onClick={() => runBulk('delete')}
                    >
                      <Icon name="trash" size={18} />
                      {t('delete')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="bulk-top">
                    <label className="check bulk-all">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        disabled={!list.data.length}
                        onChange={() =>
                          setSelected(allSelected ? [] : list.data.map(({ objectId }) => objectId))
                        }
                      />
                      <span>{selected.length ? t('{{count}} selected', { count: selected.length }) : t('select all')}</span>
                    </label>
                    <button type="button" className="btn btn-quiet bulk-cancel" onClick={stopSelecting}>
                      {t('cancel')}
                    </button>
                  </div>
                  <div className="bulk-actions">
                    {bulkActions.map(({ key, name, icon }) => (
                      <button
                        type="button"
                        key={`${key}-${icon}`}
                        className={cls('act', `act-${key}`)}
                        disabled={!selected.length || busy}
                        onClick={() => runBulk(key)}
                      >
                        <Icon name={icon} size={18} />
                        <span>{name}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="act act-delete danger"
                      disabled={!selected.length || busy}
                      onClick={() => setConfirmBulk(true)}
                    >
                      <Icon name="trash" size={18} />
                      <span>{t('delete')}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}
        </>
      )}

      <CommentSheet
        open={sheetOpen && sheet.type === 'more'}
        comment={moreTarget}
        actions={moreTarget ? moreFor(moreTarget) : []}
        onClose={closeSheet}
        onError={setNotice}
      />
      <ReplySheet
        open={sheetOpen && sheet.type === 'reply'}
        comment={live('reply')}
        seq={sheet.seq}
        onSend={(text) => onReply(sheet.reply, text)}
        onClose={closeSheet}
      />
      <EditSheet
        open={sheetOpen && sheet.type === 'edit'}
        comment={live('edit')}
        seq={sheet.seq}
        onSave={(data) => onEdit(sheet.edit, data)}
        onClose={closeSheet}
      />
    </Layout>
  );
}
