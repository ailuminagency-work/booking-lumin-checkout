/* Internal controlled staging fixture only; no owner writer or merchant-origin grant. */
(() => {
  'use strict';
  const status = document.getElementById('fixture-status');
  if (location.origin !== 'https://booking-lumin-portal-staging.netlify.app') {
    if (status) status.textContent = 'Fixture unavailable: only the exact Portal staging origin is permitted.';
    return;
  }
  const inline = document.getElementById('inline-install');
  const launcher = document.getElementById('launcher-install');
  if (!status || !inline || !launcher || inline.hasAttribute('data-fixture-started') || launcher.hasAttribute('data-fixture-started')) return;
  inline.setAttribute('data-fixture-started', 'true');
  launcher.setAttribute('data-fixture-started', 'true');
  status.textContent = 'Loading controlled staging controllers. Browser and iframe loading remain unverified.';
  let loaded = 0;
  let failed = false;
  for (const [host, mode] of [[inline, 'inline'], [launcher, 'launcher']]) {
    const script = document.createElement('script');
    script.src = 'https://booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js';
    script.setAttribute('data-installation', '66000000-0000-4000-8000-000000000006');
    script.setAttribute('data-mode', mode);
    script.referrerPolicy = 'no-referrer';
    script.addEventListener('load', () => {
      loaded++;
      if (!failed && loaded === 2) status.textContent = 'Controllers loaded. Explicit browser, keyboard and iframe checks are still required; booking and payment remain untested.';
    });
    script.addEventListener('error', () => {
      failed = true;
      status.textContent = 'A staging controller could not load. Installation and browser loading remain unverified.';
    });
    host.append(script);
  }
})();
