import request from '../utils/request.js';

export const getCommentList = ({ page = 1, filter }) =>
  request({
    url: `comment?type=list&owner=${encodeURIComponent(filter.owner)}&status=${encodeURIComponent(filter.status)}&keyword=${encodeURIComponent(filter.keyword)}&page=${page}`,
    method: 'GET',
  });

export const updateComment = (id, data) =>
  request({
    url: `comment/${id}`,
    method: 'PUT',
    body: data,
  });

export const replyComment = (data) =>
  request({
    url: 'comment',
    method: 'POST',
    body: data,
  });

export const deleteComment = (id) =>
  request({
    url: `comment/${id}`,
    method: 'DELETE',
  });

export const getRecentComments = ({ page = 1, pageSize = 100 }) =>
  request({
    url: `comment?type=list&owner=all&page=${page}&pageSize=${pageSize}`,
    method: 'GET',
  });

export const getPostComments = ({ path, page = 1, pageSize = 100 }) =>
  request({
    url: `comment?path=${encodeURIComponent(path)}&page=${page}&pageSize=${pageSize}&sortBy=insertedAt_asc`,
    method: 'GET',
  });
