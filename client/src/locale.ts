export interface Locale {
  nick: string;
  placeholder: string;
  word: string;
  submit: string;
  anonymous: string;
  like: string;
  cancelLike: string;
  reply: string;
  cancelReply: string;
  more: string;
  sticky: string;
  now: string;
  commentUnderReview: string;
}

export const ENGLISH: Locale = {
  nick: 'NickName',
  placeholder: 'Comment here...',
  word: 'Words',
  submit: 'Submit',
  anonymous: 'Anonymous',
  like: 'Like',
  cancelLike: 'Cancel like',
  reply: 'Reply',
  cancelReply: 'Cancel reply',
  more: 'Load More...',
  sticky: 'Sticky',
  now: 'just now',
  commentUnderReview:
    'Your comment is under review and is currently only visible to you. It will be publicly visible after approval.',
};
