import React from 'react';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router';

export default function Access({ meta = {}, children }) {
  const user = useSelector((state) => state.user);
  const location = useLocation();

  if (!user?.objectId) {
    const target = `${location.pathname}${location.search}`;

    return <Navigate to={`/login?redirect=${encodeURIComponent(target)}`} replace />;
  }

  if (meta.auth && meta.auth !== user.type) {
    return <Navigate to="/profile" replace />;
  }

  return children;
}
