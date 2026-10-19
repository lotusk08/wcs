<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue';

import type { Comment, RootComment } from '../api.ts';
import { contextKey } from '../config.ts';
import { AdministratorIcon, LikeIcon, ReplyIcon, VerifiedIcon } from '../icons.ts';
import { isLinkHttp, timeAgo } from '../utils.ts';
import CommentBox from './CommentBox.vue';

const { comment, rootId, reply = null } = defineProps<{
  comment: RootComment;
  rootId: number;
  reply?: Comment | null;
}>();

const emit = defineEmits<{
  (event: 'submit' | 'like', comment: Comment): void;
  (event: 'reply', comment: Comment | null): void;
}>();

const { config, now, likes } = inject(contextKey)!;

const locale = computed(() => config.value.locale);

const link = computed(() => {
  const { link } = comment;

  return link ? (isLinkHttp(link) ? link : `https://${link}`) : '';
});

const liked = computed(() => likes.value.includes(comment.objectId));

const time = computed(() => timeAgo(comment.time, now.value, config.value.lang, locale.value));

const replying = computed(() => comment.objectId === reply?.objectId);

const content = ref<HTMLElement>();

const scrollable = (): void => {
  content.value?.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
    code.tabIndex = 0;
  });
};

onMounted(scrollable);
watch(() => comment.comment, scrollable, { flush: 'post' });
</script>

<template>
  <div :id="comment.objectId.toString()" class="line-card-item">
    <div class="line-user" aria-hidden="true">
      <img v-if="comment.avatar" class="line-user-avatar" :src="comment.avatar" alt="" />
      <VerifiedIcon v-if="comment.type === 'guest'" />
      <AdministratorIcon v-if="comment.type === 'administrator'" />
    </div>

    <div class="line-card">
      <div class="line-head">
        <a
          v-if="link"
          class="line-nick"
          :href="link"
          target="_blank"
          rel="ugc nofollow noreferrer noopener"
        >{{ comment.nick }}</a>
        <span v-else class="line-nick">{{ comment.nick }}</span>

        <span v-if="comment.label" class="line-badge" v-text="comment.label" />
        <span v-if="comment.sticky" class="line-badge" v-text="locale.sticky" />
        <span class="line-time" v-text="time" />

        <div class="line-comment-actions">
          <button
            type="button"
            class="line-like"
            :class="{ active: liked }"
            :title="liked ? locale.cancelLike : locale.like"
            @click="emit('like', comment)"
          >
            <LikeIcon :active="liked" />
            <span v-text="comment.like" />
          </button>

          <button
            type="button"
            class="line-reply"
            :class="{ active: replying }"
            :title="replying ? locale.cancelReply : locale.reply"
            @click="emit('reply', replying ? null : comment)"
          >
            <ReplyIcon />
          </button>
        </div>
      </div>

      <div class="line-meta" aria-hidden="true">
        <template v-for="item in (['addr', 'browser', 'os'] as const)" :key="item">
          <span v-if="comment[item]" :class="`line-${item}`" :data-value="comment[item]" v-text="comment[item]" />
        </template>
      </div>

      <div v-if="comment.status === 'waiting'" class="line-warning">
        {{ locale.commentUnderReview }}
      </div>

      <div class="line-content">
        <p v-if="comment.reply_user" class="line-reply-to">
          <a :href="`#${comment.pid}`">@{{ comment.reply_user.nick }}</a>
          <span>: </span>
        </p>

        <div ref="content" v-html="comment.comment" />
      </div>

      <div v-if="replying" class="line-reply-wrapper">
        <CommentBox
          :reply-id="reply?.objectId"
          :reply-user="comment.nick"
          :root-id="rootId"
          @cancel-reply="emit('reply', null)"
          @submit="emit('submit', $event)"
        />
      </div>

      <div v-if="comment.children" class="line-quote">
        <CommentCard
          v-for="child in comment.children"
          :key="child.objectId"
          :comment="child"
          :reply="reply"
          :root-id="rootId"
          @like="emit('like', $event)"
          @reply="emit('reply', $event)"
          @submit="emit('submit', $event)"
        />
      </div>
    </div>
  </div>
</template>
