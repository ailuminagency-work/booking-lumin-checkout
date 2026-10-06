/* Internal controlled staging fixture only; no owner writer or merchant-origin grant. */
(() => {
  'use strict';
  const status = document.getElementById('fixture-status');
  const origins = ['https://booking-lumin-portal-staging.netlify.app', 'https://deploy-preview-97--booking-lumin-portal-staging.netlify.app'];
  if (!origins.includes(location.origin) || location.search || location.hash) {
    if (status) status.textContent = 'Fixture unavailable: only the exact approved Portal staging origins without query or fragment overrides are permitted.';
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
    script.setAttribute('data-installation', '0fe09ceb-7660-444d-bb6a-161eb4baa665');
    script.setAttribute('data-mode', mode);
    script.referrerPolicy = 'no-referrer';
    let loadSeen = false;
    script.addEventListener('load', () => {
      if (loadSeen) return;
      loadSeen = true;
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
