import React from 'react';

export default function Notice({ children, onClose }) {
  if (!children) return null;

  return (
    <div className="notice" role="alert">
      <span>{children}</span>
      {onClose ? (
        <button type="button" className="notice-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      ) : null}
    </div>
  );
}
