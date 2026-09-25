import React, { useLayoutEffect, useRef } from 'react';

export default function AutoTextarea({ onInput, ...props }) {
  const ref = useRef(null);

  const fit = () => {
    const el = ref.current;

    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };

  useLayoutEffect(fit, []);

  return (
    <textarea
      ref={ref}
      onInput={(event) => {
        fit();
        onInput?.(event);
      }}
      {...props}
    />
  );
}
