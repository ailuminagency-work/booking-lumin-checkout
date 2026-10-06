import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {afterEach,expect,it,vi} from 'vitest';
const code=readFileSync('public/booking-lumin-staging.js','utf8');
const origin='https://booking-lumin-checkout-staging.netlify.app';
const id='c52f77b7-dcfd-4280-b52d-1714514873c8';
function run(options:{parent?:string;source?:string;id?:string;mode?:string;script?:HTMLScriptElement}={}){
 const script=options.script??document.createElement('script');script.src=options.source??origin+'/booking-lumin-staging.js';script.setAttribute('data-installation',options.id??id);if(options.mode)script.setAttribute('data-mode',options.mode);if(!script.isConnected)document.body.append(script);
 runInNewContext(code,{document:{currentScript:script,createElement:document.createElement.bind(document),querySelectorAll:document.querySelectorAll.bind(document)},location:{origin:options.parent??origin},URL,Set});return script;
}
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it('mounts a fixed immutable hosted route with test label and bounded sandbox; no message bridge',()=>{
 const listener=vi.spyOn(window,'addEventListener');run();const f=document.querySelector('iframe')!;expect(f.src).toBe(origin+'/checkout/flow/'+id);expect(f.title).toMatch(/staging/);expect(f.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-same-origin');expect(f.getAttribute('allow')).toContain("payment 'none'");expect(f.referrerPolicy).toBe('no-referrer');expect(document.body.textContent).toContain('No real money');expect(listener).not.toHaveBeenCalledWith('message',expect.anything());expect(document.querySelector('a')?.rel).toBe('noopener noreferrer');
});
it.each(['https://merchant.example','http://booking-lumin-portal-staging.netlify.app','null','https://booking-lumin-portal-staging.netlify.app.evil.test'])('rejects nonapproved parent %s without installing',parent=>{run({parent});expect(document.querySelector('iframe')).toBeNull();expect(document.querySelector('section')).toBeNull();});
it.each([origin+'/booking-lumin-staging.js?token=x',origin+'/booking-lumin-staging.js#x','https://evil.test/booking-lumin-staging.js'])('rejects untrusted or credential-bearing source %s',source=>{run({source});expect(document.querySelector('section')).toBeNull();});
it.each(['../../settings','x" onload="alert(1)','C52F77B7-DCFD-4280-B52D-1714514873C8',''])('rejects invalid installation %s',value=>{run({id:value});expect(document.querySelector('section')).toBeNull();});
it('rejects unknown mode, duplicate execution and excess instances',()=>{run({mode:'popup-unsafe'});expect(document.querySelector('section')).toBeNull();document.body.replaceChildren();const s=run();run({script:s});expect(document.querySelectorAll('iframe')).toHaveLength(1);for(let i=0;i<9;i++)run();expect(document.querySelectorAll('section')).toHaveLength(8);});
it('launcher is lazy and reopens the same iframe after closing, restoring focus',()=>{
 run({mode:'launcher',parent:'https://booking-lumin-portal-staging.netlify.app'});const dialog=document.querySelector('dialog')!;
 const show=vi.fn(()=>{dialog.open=true;});dialog.showModal=show;dialog.close=()=>{dialog.open=false;dialog.dispatchEvent(new Event('close'));};
 const [launcher,close]=Array.from(document.querySelectorAll('button'));expect(document.querySelector('iframe')).toBeNull();launcher!.click();const f=document.querySelector('iframe');expect(show).toHaveBeenCalledTimes(1);expect(launcher!.getAttribute('aria-expanded')).toBe('true');expect(document.activeElement).toBe(close);close!.click();expect(document.activeElement).toBe(launcher);expect(launcher!.getAttribute('aria-expanded')).toBe('false');launcher!.click();expect(document.querySelector('iframe')).toBe(f);expect(show).toHaveBeenCalledTimes(2);
});
it('offers a visible direct-link fallback when native modal support is absent',()=>{run({mode:'launcher'});const dialog=document.querySelector('dialog')!;Object.defineProperty(dialog,'showModal',{value:undefined});document.querySelector('button')!.click();expect(document.querySelector('iframe')).toBeNull();expect(document.activeElement).toBe(document.querySelector('section > a'));});

const approvedPreviewParent='https://deploy-preview-97--booking-lumin-portal-staging.netlify.app';
const approvedPreviewSource='https://deploy-preview-97--booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js';
it('loads the exact preview controller only for the exact Portal97 preview, keeping the customer frame canonical',()=>{
 run({parent:approvedPreviewParent,source:approvedPreviewSource});
 expect(document.querySelector('iframe')?.src).toBe(origin+'/checkout/flow/'+id);
 expect(document.querySelector('iframe')?.getAttribute('allow')).toContain("payment 'none'");
});
it.each([
 [approvedPreviewParent,origin+'/booking-lumin-staging.js'],
 [origin,approvedPreviewSource],
 ['https://booking-lumin-portal-staging.netlify.app',approvedPreviewSource],
 ['https://deploy-preview-98--booking-lumin-portal-staging.netlify.app',approvedPreviewSource],
 [approvedPreviewParent,approvedPreviewSource+'?token=PRIVATE_TOKEN'],
 [approvedPreviewParent,approvedPreviewSource+'#PRIVATE_TOKEN'],
 [approvedPreviewParent,'https://deploy-preview-98--booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js'],
 [approvedPreviewParent,'http://deploy-preview-97--booking-lumin-checkout-staging.netlify.app/booking-lumin-staging.js'],
 ['https://deploy-preview-97--booking-lumin-portal-staging.netlify.app.evil.test',approvedPreviewSource],
 ['http://deploy-preview-97--booking-lumin-portal-staging.netlify.app',approvedPreviewSource],
 ['https://deploy-preview-97--booking-lumin-portal-staging.netlify.app:444',approvedPreviewSource]
])('rejects mismatched preview parent/source %s %s without any form', (parent,source)=>{
 run({parent,source});expect(document.querySelector('section,iframe,a,button')).toBeNull();
 expect(document.body.textContent).not.toContain('PRIVATE_TOKEN');
});
