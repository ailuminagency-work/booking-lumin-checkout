/* Controlled staging installation for the existing immutable hosted customer form.
 * This is not the mode-installation policy/controller or a production-domain grant. */
(() => {
  'use strict';
  const script = document.currentScript;
  const origin = 'https://booking-lumin-checkout-staging.netlify.app';
  const previewParent = 'https://deploy-preview-97--booking-lumin-portal-staging.netlify.app';
  const previewSource = 'https://deploy-preview-97--booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js';
  const parents = new Set([origin, 'https://booking-lumin-portal-staging.netlify.app', previewParent]);
  if (!script || !parents.has(location.origin)) return;
  let source;
  try { source = new URL(script.src); } catch { return; }
  const expectedSource = location.origin === previewParent ? previewSource : origin + '/booking-lumin-staging.js';
  if (source.href !== expectedSource) return;
  const id = script.getAttribute('data-installation');
  const mode = script.getAttribute('data-mode') || 'inline';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id || '') ||
      !['inline', 'launcher'].includes(mode) || script.hasAttribute('data-lumin-mounted') ||
      document.querySelectorAll('[data-lumin-staging-install]').length >= 8) return;
  const host = document.createElement('section');
  host.setAttribute('data-lumin-staging-install', id);
  host.setAttribute('aria-label', 'Booking Lumin staging installation');
  Object.assign(host.style, {width:'100%', maxWidth:'100%', minWidth:'0', overflowWrap:'anywhere'});
  const note = document.createElement('p');
  note.textContent = 'STAGING / TEST — payment is simulated. No real money is charged.';
  host.append(note);
  const url = origin + '/checkout/flow/' + id;
  const fallback = document.createElement('a');
  fallback.href = url;
  fallback.target = '_blank';
  fallback.rel = 'noopener noreferrer';
  fallback.textContent = 'Open the staging booking form in a new tab';
  let frame;
  function createFrame() {
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.title = 'Booking Lumin staging booking form';
    frame.src = url;
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
    Object.assign(frame.style, {display:'block', width:'100%', maxWidth:'100%', minWidth:'0', height:'640px', border:'0'});
    return frame;
  }
  if (mode === 'inline') host.append(createFrame(), fallback);
  else {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Book a staging test';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    Object.assign(button.style, {minHeight:'44px', maxWidth:'100%', whiteSpace:'normal'});
    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-label', 'Staging booking form');
    Object.assign(dialog.style, {boxSizing:'border-box', width:'min(720px, calc(100vw - 24px))', maxWidth:'calc(100vw - 24px)', maxHeight:'90vh', padding:'12px', overflow:'auto'});
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close booking form';
    Object.assign(close.style, {minHeight:'44px', maxWidth:'100%'});
    function finish() { button.setAttribute('aria-expanded', 'false'); button.focus(); }
    close.addEventListener('click', () => { dialog.close(); });
    dialog.addEventListener('close', finish);
    window.addEventListener('message', event => {
      if (!dialog.open || !frame || event.origin !== origin || event.source !== frame.contentWindow ||
          event.data !== 'booking-lumin-staging:escape') return;
      if (dialog.dispatchEvent(new Event('cancel', {cancelable:true}))) dialog.close();
    });
    dialog.append(close, fallback);
    button.addEventListener('click', () => {
      if (typeof dialog.showModal !== 'function' || typeof dialog.close !== 'function') { alternative.focus(); return; }
      if (!frame) dialog.insertBefore(createFrame(), fallback);
      if (!dialog.open) { dialog.showModal(); button.setAttribute('aria-expanded', 'true'); close.focus(); }
    });
    host.append(button, dialog);
    const alternative = fallback.cloneNode(true);
    host.append(alternative);
  }
  script.setAttribute('data-lumin-mounted', 'true');
  script.insertAdjacentElement('beforebegin', host);
})();
