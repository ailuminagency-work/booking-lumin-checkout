import { useEffect } from 'react';

const checkout = 'https://booking-lumin-checkout-staging.netlify.app';
const parents = ['https://booking-lumin-portal-staging.netlify.app', 'https://deploy-preview-97--booking-lumin-portal-staging.netlify.app'];
const message = 'booking-lumin-staging:escape';

// No customer data or booking action crosses this staging-only accessibility bridge.
export function installStagingInstallEscape(stage: boolean, child: Window = window): () => void {
  const page = child.location;
  if (!stage || page.origin !== checkout || page.search || page.hash || child.parent === child ||
      !/^\/checkout\/flow\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/.test(page.pathname)) return () => {};
  const pending = new Set<number>();
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    // Preserve native picker/combobox dismissal and a child modal's own Escape handling.
    if (target instanceof Element && target.closest('select,[popover],input[list],input[type="search"],input[type="date"],input[type="time"],input[type="datetime-local"],input[type="month"],input[type="week"],input[type="color"],[role="combobox"],[aria-expanded="true"]')) return;
    if (child.document.querySelector('dialog[open]')) return;
    const timer = child.setTimeout(() => {
      pending.delete(timer);
      if (event.defaultPrevented) return;
      for (const origin of parents) child.parent.postMessage(message, origin);
    }, 0);
    pending.add(timer);
  };
  child.addEventListener('keydown', onKey);
  return () => {
    child.removeEventListener('keydown', onKey);
    for (const timer of pending) child.clearTimeout(timer);
  };
}

export function useStagingInstallEscape() {
  useEffect(() => installStagingInstallEscape(import.meta.env.MODE === 'staging'), []);
}
