import { Navigate, useLocation } from 'react-router-dom';

const LEGACY: Readonly<Record<string, string>> = {
  '/availability': '/calendar/availability',
  '/resources': '/services/resources',
  '/checkout': '/embed',
};

/** Kept outside mode-specific content so login/error paths also honor old links. */
export function LegacyRedirects() {
  const location = useLocation();
  const destination = LEGACY[location.pathname.replace(/\/$/, '')];
  return destination ? <Navigate replace to={{ pathname: destination, search: location.search, hash: location.hash }} /> : null;
}
