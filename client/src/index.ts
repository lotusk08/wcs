import { createApp, h, reactive } from 'vue';

import LineComments from './components/LineComments.vue';
import type { LineProps } from './config.ts';

export { default as style } from './style.css?inline';

interface LineOptions extends Partial<LineProps> {
  el: string | HTMLElement;
  serverURL: string;
}

interface LineInstance {
  el: HTMLElement;
  update: (options?: Partial<Omit<LineOptions, 'el'>>) => void;
  destroy: () => void;
}

export const init = ({ el, path = window.location.pathname, ...options }: LineOptions): LineInstance => {
  const root = el instanceof HTMLElement ? el : document.querySelector<HTMLElement>(el);

  if (!root) throw new Error("Option 'el' do not match any domElement!");
  if (!options.serverURL) throw new Error("Option 'serverURL' is missing!");

  const props = reactive<LineProps>({ ...options, path });
  const app = createApp(() => h(LineComments, props));

  app.mount(root);

  return {
    el: root,
    update: ({ path = window.location.pathname, ...next } = {}): void => {
      Object.assign(props, next, { path });
    },
    destroy: (): void => {
      app.unmount();
    },
  };
};
