<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import type { Comment, RootComment } from '../api.ts';
import { getComments, likeComment } from '../api.ts';
import type { LineProps } from '../config.ts';
import { contextKey } from '../config.ts';
import { ENGLISH } from '../locale.ts';
import { useStore } from '../storage.ts';
import { decodePath, serverOf } from '../utils.ts';
import CommentBox from './CommentBox.vue';
import CommentCard from './CommentCard.vue';

const props = defineProps<LineProps>();

const store = useStore();
const { likes } = store;
const now = ref(Date.now());
const status = ref<'loading' | 'success' | 'error'>('loading');
const page = ref(1);
const totalPages = ref(0);
const data = ref<RootComment[]>([]);
const reply = ref<Comment | null>(null);

const config = computed(() => ({
  serverURL: serverOf(props.serverURL),
  path: decodePath(props.path),
  lang: props.lang ?? 'en',
  locale: { ...ENGLISH, ...props.locale },
  named: (props.meta ?? ['nick']).includes('nick'),
}));

const locale = computed(() => config.value.locale);

const liking = new Set<number>();

let abort: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

const load = (pageNumber: number): void => {
  const controller = new AbortController();

  status.value = 'loading';
  abort?.();

  getComments(config.value, pageNumber, controller.signal)
    .then((resp) => {
      now.value = Date.now();
      status.value = 'success';
      data.value.push(...resp.data);
      page.value = pageNumber;
      totalPages.value = resp.totalPages;
    })
    .catch((err: unknown) => {
      if ((err as Error).name !== 'AbortError') {
        console.error((err as Error).message);
        status.value = 'error';
      }
    });

  abort = controller.abort.bind(controller);
};

const refresh = (): void => {
  reply.value = null;
  data.value = [];
  load(1);
};

const onReply = (comment: Comment | null): void => {
  reply.value = comment;
};

const onSubmit = (comment: Comment): void => {
  now.value = Date.now();

  if (comment.rid) {
    const root = data.value.find(({ objectId }) => objectId === comment.rid);

    if (!root) return;
    if (!Array.isArray(root.children)) root.children = [];

    root.children.push(comment);
  } else {
    data.value.unshift(comment);
  }
};

const onLike = async (comment: Comment): Promise<void> => {
  const { objectId } = comment;

  if (liking.has(objectId)) return;

  const liked = likes.value.includes(objectId);

  liking.add(objectId);

  try {
    await likeComment(config.value, objectId, !liked);
  } finally {
    liking.delete(objectId);
  }

  likes.value = liked ? likes.value.filter((id) => id !== objectId) : [...likes.value, objectId].slice(-50);
  comment.like = Math.max(0, (comment.like || 0) + (liked ? -1 : 1));
};

provide(contextKey, { config, now, ...store });

onMounted(() => {
  watch(() => [props.serverURL, props.path], refresh, { immediate: true });
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  abort?.();
  clearInterval(timer);
});
</script>

<template>
  <div data-line>
    <CommentBox v-if="!reply" @submit="onSubmit" />

    <div class="line-cards">
      <CommentCard
        v-for="comment in data"
        :key="comment.objectId"
        :root-id="comment.objectId"
        :comment="comment"
        :reply="reply"
        @reply="onReply"
        @submit="onSubmit"
        @like="onLike"
      />
    </div>

    <div v-if="status !== 'loading' && data.length && page < totalPages" class="line-operation">
      <button type="button" class="line-btn" @click="load(page + 1)" v-text="locale.more" />
    </div>
  </div>
</template>
