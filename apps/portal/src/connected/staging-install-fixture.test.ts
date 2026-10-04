import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,expect,it} from 'vitest';
const html=readFileSync('public/staging-install-check.html','utf8');
const boot=readFileSync('public/staging-install-check.js','utf8');
const portal='https://booking-lumin-portal-staging.netlify.app';
const checkout='https://booking-lumin-checkout-staging.netlify.app';
function run(origin=portal){runInNewContext(boot,{document,location:{origin}});}
function prepare(){document.body.innerHTML=new DOMParser().parseFromString(html,'text/html').body.innerHTML;}
afterEach(()=>document.body.replaceChildren());
it('loads only the two fixed cross-origin controllers from an accessible controlled fixture',()=>{
 prepare();expect(document.querySelector('h1')?.textContent).toContain('Internal staging cross-origin');expect(document.body.textContent).toContain('Payments are simulated');expect(document.body.textContent).toContain('not owner publication');expect(document.querySelectorAll('script,iframe')).toHaveLength(0);
 run();const scripts=Array.from(document.querySelectorAll('script'));expect(scripts).toHaveLength(2);
 for(const [index,script] of scripts.entries()){const url=new URL(script.src);expect(url.href).toBe(checkout+'/booking-lumin-staging.js');expect(url.origin).not.toBe(portal);expect(url.search).toBe('');expect(url.hash).toBe('');expect(script.getAttribute('data-installation')).toBe('66000000-0000-4000-8000-000000000006');expect(script.getAttribute('data-mode')).toBe(index===0?'inline':'launcher');expect(script.referrerPolicy).toBe('no-referrer');expect(script.textContent).toBe('');}
 expect(document.querySelector('iframe')).toBeNull();expect(document.querySelector('[role="status"]')?.textContent).toContain('unverified');expect(document.body.textContent).toContain('Escape');expect(document.querySelectorAll('section[aria-labelledby]')).toHaveLength(2);run();expect(document.querySelectorAll('script')).toHaveLength(2);
});
it.each(['https://merchant.example','http://booking-lumin-portal-staging.netlify.app','https://booking-lumin-portal-staging.netlify.app.evil.test','https://booking-lumin-checkout-staging.netlify.app','null','https://booking-lumin-portal-staging.netlify.app:444'])('rejects origin %s before loading any controller',origin=>{prepare();run(origin);expect(document.querySelectorAll('script,iframe,a')).toHaveLength(0);expect(document.querySelector('[role="status"]')?.textContent).toContain('Fixture unavailable');});
it('keeps load and error events honest without treating script delivery as browser acceptance',()=>{prepare();run();const scripts=document.querySelectorAll('script');scripts[0]!.dispatchEvent(new Event('load'));scripts[1]!.dispatchEvent(new Event('load'));expect(document.querySelector('[role="status"]')?.textContent).toContain('checks are still required');scripts[0]!.dispatchEvent(new Event('error'));scripts[1]!.dispatchEvent(new Event('load'));expect(document.querySelector('[role="status"]')?.textContent).toContain('remain unverified');});
it('has only a fixed local deferred boot and no form, credentials, dynamic URL inputs or automatic booking actions',()=>{const page=new DOMParser().parseFromString(html,'text/html');const script=page.querySelector('script')!;expect(script.getAttribute('src')).toBe('/staging-install-check.js');expect(script.hasAttribute('defer')).toBe(true);expect(page.querySelectorAll('script')).toHaveLength(1);expect(page.querySelectorAll('form,input,textarea,iframe')).toHaveLength(0);expect(boot).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|location\.(search|hash)|innerHTML|eval\(/);});
