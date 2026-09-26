import cls from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import Avatar from '../../components/Avatar.jsx';
import Icon from '../../components/icon/ui.jsx';
import CommentTime from './CommentTime.jsx';
import { cachedPosts, loadPosts, threadLink } from './threads.js';
import { excerpt, postPath, postTitle } from './utils.js';

function PostRow({ post }) {
  const { t } = useTranslation();
  const { url, count, waiting, spam, latest } = post;

  return (
    <li>
      <Link className="post-row" to={threadLink(url)}>
        <span className="post-row-head">
          <strong className="post-row-title">{postTitle(url)}</strong>
          <CommentTime value={latest.insertedAt ?? latest.time} />
        </span>
        <span className="post-row-path">{postPath(url)}</span>
        <span className="post-row-latest">
          <Avatar src={latest.avatar} size={20} className="post-row-avatar" />
          <span className="post-row-excerpt">
            <strong>{latest.nick}</strong> {excerpt(latest.comment, 160)}
          </span>
        </span>
        <span className="post-row-stats">
          <span className="stat">
            <Icon name="comments" size={14} />
            {t('{{count}} comments', { count })}
          </span>
          {waiting ? <span className="stat stat-waiting">{t('{{count}} waiting', { count: waiting })}</span> : null}
          {spam ? <span className="stat stat-spam">{t('{{count}} spam', { count: spam })}</span> : null}
        </span>
      </Link>
    </li>
  );
}

export default function PostsView({ onError }) {
  const { t } = useTranslation();
  const [state, setState] = useState(cachedPosts);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setState(await loadPosts());
    } catch (err) {
      setFailed(true);
      onError?.(err.message);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
  }, [load]);

  const posts = state?.posts ?? [];

  return (
    <section className="posts" aria-label={t('by post')}>
      {state && posts.length ? (
        <p className="posts-note">
          {t('{{count}} posts', { count: posts.length })}
          {' · '}
          {state.truncated
            ? t('showing latest {{count}} comments', { count: state.scanned })
            : t('{{count}} comments', { count: state.scanned })}
        </p>
      ) : null}

      <ul className={cls('post-list', { 'is-loading': loading && Boolean(state) })} aria-busy={loading}>
        {loading && !state
          ? [0, 1, 2, 3].map((key) => (
              <li key={key} className="post-skeleton" aria-hidden="true">
                <span className="sk sk-line sk-short" />
                <span className="sk sk-line sk-mid" />
                <span className="sk sk-line" />
              </li>
            ))
          : null}
        {failed && !state ? (
          <li className="empty">
            <Icon name="inbox" size={36} />
            <p>{t('could not load')}</p>
            <button type="button" className="btn" onClick={load}>
              {t('retry')}
            </button>
          </li>
        ) : null}
        {state && !posts.length ? (
          <li className="empty">
            <Icon name="inbox" size={36} />
            <p>{t('no comments')}</p>
          </li>
        ) : null}
        {posts.map((post) => (
          <PostRow key={post.url} post={post} />
        ))}
      </ul>
    </section>
  );
}
