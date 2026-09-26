import { getPostComments, getRecentComments } from '../../services/comment.js';
import { commentTime } from './utils.js';

export const PAGE_SIZE = 100;
export const POST_PAGES = 10;
const THREAD_PAGES = 50;

const cache = { posts: null, threads: new Map() };

const pagesAfter = (total, cap) => Array.from({ length: Math.max(0, Math.min(total || 1, cap) - 1) }, (_, index) => index + 2);

const byTime = (left, right) => commentTime(left) - commentTime(right) || String(left.objectId).localeCompare(String(right.objectId), undefined, { numeric: true });

export const threadLink = (url, focus) =>
  `/thread?path=${encodeURIComponent(url ?? '')}${focus ? `&focus=${encodeURIComponent(focus)}` : ''}`;

export const cachedPosts = () => cache.posts;

export const cachedThread = (path) => cache.threads.get(path) ?? null;

export const storeThread = (path, comments) => {
  cache.threads.set(path, comments);
};

export async function loadPosts() {
  const first = await getRecentComments({ page: 1, pageSize: PAGE_SIZE });
  const rest = await Promise.all(
    pagesAfter(first.totalPages, POST_PAGES).map((page) => getRecentComments({ page, pageSize: PAGE_SIZE })),
  );
  const seen = new Map();

  for (const comment of [first, ...rest].flatMap((result) => result.data ?? [])) {
    seen.set(comment.objectId, comment);
  }

  const groups = new Map();

  for (const comment of seen.values()) {
    const url = comment.url ?? '';
    const time = commentTime(comment);
    const group = groups.get(url) ?? { url, count: 0, waiting: 0, spam: 0, latest: comment, time };

    group.count += 1;
    if (comment.status === 'waiting') group.waiting += 1;
    if (comment.status === 'spam') group.spam += 1;
    if (time > group.time) {
      group.latest = comment;
      group.time = time;
    }
    groups.set(url, group);
  }

  cache.posts = {
    posts: [...groups.values()].sort((left, right) => right.time - left.time),
    scanned: seen.size,
    truncated: (first.totalPages || 0) > POST_PAGES,
  };

  return cache.posts;
}

export async function loadThread(path) {
  const first = await getPostComments({ path, page: 1, pageSize: PAGE_SIZE });
  const rest = await Promise.all(
    pagesAfter(first.totalPages, THREAD_PAGES).map((page) => getPostComments({ path, page, pageSize: PAGE_SIZE })),
  );
  const seen = new Map();

  for (const { children = [], ...root } of [first, ...rest].flatMap((result) => result.data ?? [])) {
    for (const comment of [root, ...children]) {
      seen.set(comment.objectId, { ...comment, url: comment.url ?? path });
    }
  }

  const comments = [...seen.values()].sort(byTime);

  storeThread(path, comments);

  return comments;
}

export function buildThread(comments = []) {
  const key = (value) => (value == null || value === '' ? '' : String(value));
  const byId = new Map(comments.map((comment) => [key(comment.objectId), comment]));
  const rootOf = (comment) => {
    let current = comment;

    for (let depth = 0; depth < 64 && byId.has(key(current.rid)) && byId.get(key(current.rid)) !== current; depth += 1) {
      current = byId.get(key(current.rid));
    }

    return current;
  };
  const groups = new Map();

  for (const comment of comments) {
    const root = rootOf(comment);
    const id = key(root.objectId);

    if (!groups.has(id)) groups.set(id, { root, replies: [] });
    if (root !== comment) {
      const parent = byId.get(key(comment.pid));

      groups.get(id).replies.push({ comment, parent: parent && parent !== root ? parent : null });
    }
  }

  return [...groups.values()].sort((left, right) => byTime(left.root, right.root));
}

export const threadCounts = (comments = []) => ({
  total: comments.length,
  waiting: comments.filter(({ status }) => status === 'waiting').length,
  spam: comments.filter(({ status }) => status === 'spam').length,
});
