import type { LineConfig } from './config.ts';

export interface Comment {
  objectId: number;
  comment: string;
  nick: string;
  link?: string;
  avatar: string;
  time: number;
  like: number;
  status?: 'approved' | 'waiting' | 'spam';
  type?: 'administrator' | 'guest';
  label?: string;
  sticky?: boolean;
  addr?: string;
  browser?: string;
  os?: string;
  pid?: number;
  rid?: number;
  reply_user?: { nick: string; link: string; avatar: string };
}

export interface RootComment extends Comment {
  children?: Comment[];
}

export interface CommentData {
  comment: string;
  nick: string;
  mail: string;
  link: string;
  url: string;
  ua: string;
  pid?: number;
  rid?: number;
  at?: string;
}

interface CommentPage {
  count: number;
  page: number;
  pageSize: number;
  totalPages: number;
  data: RootComment[];
}

interface Answer<T> {
  errno: number;
  errmsg: string;
  data: T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

const api = (serverURL: string): string => `${serverURL.replace(/\/?$/u, '/')}api/`;

const check = <T>(answer: Answer<T>, name: string): T => {
  if (typeof answer === 'object' && answer.errno) {
    throw new TypeError(`${name} failed with ${answer.errno}: ${answer.errmsg}`);
  }

  return answer.data;
};

export const getComments = ({ serverURL, lang, path }: LineConfig, page: number, signal: AbortSignal): Promise<CommentPage> =>
  fetch(
    `${api(serverURL)}comment?path=${encodeURIComponent(path)}&pageSize=10&page=${page}&lang=${lang}&sortBy=insertedAt_desc`,
    { signal },
  )
    .then((resp) => resp.json() as Promise<Answer<CommentPage>>)
    .then((answer) => check(answer, 'Get comment data'));

export const addComment = ({ serverURL, lang }: LineConfig, comment: CommentData): Promise<Partial<Answer<Comment>>> =>
  fetch(`${api(serverURL)}comment?lang=${lang}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(comment),
  }).then((resp) => resp.json() as Promise<Partial<Answer<Comment>>>);

export const likeComment = ({ serverURL, lang }: LineConfig, objectId: number, like: boolean): Promise<Comment> =>
  fetch(`${api(serverURL)}comment/${objectId}?lang=${lang}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ like }),
  })
    .then((resp) => resp.json() as Promise<Answer<Comment>>)
    .then((answer) => check(answer, 'Update comment'));
