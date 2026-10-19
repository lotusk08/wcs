<script setup lang="ts">
import autosize from 'autosize';
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';

import type { Comment, CommentData } from '../api.ts';
import { addComment } from '../api.ts';
import { contextKey } from '../config.ts';
import { CloseIcon, LoadingIcon } from '../icons.ts';
import { userAgent, wordCount } from '../utils.ts';

const props = defineProps<{
  rootId?: number;
  replyId?: number;
  replyUser?: string;
}>();

const emit = defineEmits<{
  (event: 'cancelReply'): void;
  (event: 'submit', comment: Comment): void;
}>();

const { config, editor, userMeta } = inject(contextKey)!;
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');
const submitting = ref(false);

const locale = computed(() => config.value.locale);
const words = computed(() => wordCount(editor.value));

const submit = async (): Promise<void> => {
  const server = config.value;

  if (submitting.value) return;

  if (!editor.value) {
    textarea.value?.focus();

    return;
  }

  submitting.value = true;

  try {
    const comment: CommentData = {
      comment: editor.value,
      nick: userMeta.value.nick,
      mail: userMeta.value.mail,
      link: userMeta.value.link,
      url: server.path,
      ua: await userAgent(),
    };

    comment.nick ||= locale.value.anonymous;
    userMeta.value = { nick: comment.nick, mail: comment.mail, link: comment.link };

    if (props.replyId && props.rootId) {
      comment.pid = props.replyId;
      comment.rid = props.rootId;
      comment.at = props.replyUser;
    }

    const response = await addComment(server, comment);

    if (response.errmsg) {
      alert(response.errmsg);

      return;
    }

    if (server.serverURL === config.value.serverURL && server.path === config.value.path) {
      emit('submit', response.data!);
    }

    editor.value = '';

    await nextTick();

    if (props.replyId) emit('cancelReply');
  } catch (err) {
    alert((err as Error).message);
  } finally {
    submitting.value = false;
  }
};

const onKeyDown = ({ key, ctrlKey, metaKey }: KeyboardEvent): void => {
  if ((ctrlKey || metaKey) && key === 'Enter') void submit();
};

onMounted(() => {
  watch(
    editor,
    (value) => {
      if (value) autosize(textarea.value!);
      else autosize.destroy(textarea.value!);
    },
    { immediate: true },
  );
});

onBeforeUnmount(() => autosize.destroy(textarea.value!));
</script>

<template>
  <div class="line-comment">
    <div class="line-panel">
      <textarea
        id="line-edit"
        ref="textarea"
        v-model="editor"
        class="line-editor"
        :placeholder="replyUser ? `@${replyUser}` : locale.placeholder"
        @keydown="onKeyDown"
      />

      <div v-if="config.named" class="line-header">
        <label for="line-nick" v-text="locale.nick" />
        <input
          id="line-nick"
          v-model="userMeta.nick"
          class="line-input line-nick"
          name="nick"
          type="text"
          :placeholder="locale.nick"
        />
      </div>

      <div class="line-footer">
        <div class="line-text-number">{{ words }} &nbsp;{{ locale.word }}</div>

        <button
          type="submit"
          class="primary line-btn"
          title="Cmd|Ctrl + Enter"
          :disabled="submitting"
          @click="submit"
        >
          <LoadingIcon v-if="submitting" />
          <template v-else>{{ locale.submit }}</template>
        </button>
      </div>
    </div>

    <button
      v-if="replyId"
      type="button"
      class="line-close"
      :title="locale.cancelReply"
      @click="emit('cancelReply')"
    >
      <CloseIcon />
    </button>
  </div>
</template>
