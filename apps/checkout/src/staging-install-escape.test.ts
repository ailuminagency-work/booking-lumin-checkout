import { afterEach, expect, it, vi } from 'vitest';
import { installStagingInstallEscape } from './staging-install-escape';

const origin = 'https://booking-lumin-checkout-staging.netlify.app';
const path = '/checkout/flow/c52f77b7-dcfd-4280-b52d-1714514873c8';
const stops: (() => void)[] = [];
function start(overrides: Partial<Location> = {}, stage = true) {
  vi.useFakeTimers();
  const post = vi.fn();
  const child = {location:{origin,pathname:path,search:'',hash:'',...overrides},parent:{postMessage:post},document,
    addEventListener:window.addEventListener.bind(window),removeEventListener:window.removeEventListener.bind(window),
    setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)} as unknown as Window;
  const stop = installStagingInstallEscape(stage, child);
  stops.push(stop);
  return {post,stop};
}
function key(options: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  const event = new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true,...options});
  target.dispatchEvent(event);
  return event;
}
afterEach(() => {for(const stop of stops.splice(0))stop();document.body.replaceChildren();vi.useRealTimers();});
it('forwards only the fixed Escape string to the two exact approved Portal target origins after default handling', () => {
  const {post}=start();key();expect(post).not.toHaveBeenCalled();vi.runAllTimers();
  expect(post.mock.calls).toEqual([
    ['booking-lumin-staging:escape','https://booking-lumin-portal-staging.netlify.app'],
    ['booking-lumin-staging:escape','https://deploy-preview-97--booking-lumin-portal-staging.netlify.app']
  ]);
});
it.each([
  {origin:'https://deploy-preview-97--booking-lumin-checkout-staging.netlify.app'},
  {origin:origin+'.evil.test'},{origin:'http://booking-lumin-checkout-staging.netlify.app'},
  {origin:origin+':444'},{search:'?parent=https://evil.test'},{hash:'#private'},
  {pathname:'/checkout/flow/../../private'},{pathname:'/checkout/flow/INVALID'},
  {pathname:path+'/extra'},{pathname:'/flow/'+path.split('/').pop()}
])('does not install from an unapproved child page %j', page=>{const {post}=start(page);key();vi.runAllTimers();expect(post).not.toHaveBeenCalled();});
it('does not install in a nonstaging build',()=>{const {post}=start({},false);key();vi.runAllTimers();expect(post).not.toHaveBeenCalled();});
it.each([{key:'Enter'},{isComposing:true},{repeat:true},{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true}])('leaves other/native key semantics untouched %j',options=>{const {post}=start();key(options);vi.runAllTimers();expect(post).not.toHaveBeenCalled();});
it('honors defaultPrevented even when a later bubble listener handles Escape',()=>{
  const {post}=start();const event=key();event.preventDefault();vi.runAllTimers();expect(post).not.toHaveBeenCalled();
});
it.each(['<select><option>A</option></select>','<input type="date">','<input type="search">','<div popover><button>Inside popover</button></div>','<input list="choices">','<input role="combobox">','<button aria-expanded="true">Menu</button>'])('preserves native picker and expanded control Escape %s',html=>{
  const {post}=start();document.body.innerHTML=html;key({},document.body.firstElementChild as HTMLElement);vi.runAllTimers();expect(post).not.toHaveBeenCalled();
});
it('allows ordinary customer text input Escape without preventing its event',()=>{const {post}=start();document.body.innerHTML='<input type="text">';const event=key({},document.querySelector('input')!);vi.runAllTimers();expect(event.defaultPrevented).toBe(false);expect(post).toHaveBeenCalledTimes(2);});
it('preserves an open child native dialog and cleans up pending work/listeners',()=>{const {post,stop}=start();document.body.innerHTML='<dialog open></dialog>';key();vi.runAllTimers();expect(post).not.toHaveBeenCalled();document.body.replaceChildren();key();stop();vi.runAllTimers();key();vi.runAllTimers();expect(post).not.toHaveBeenCalled();});
it('does not install in a top-level child window',()=>{vi.useFakeTimers();const add=vi.fn();const child={location:{origin,pathname:path,search:'',hash:''},addEventListener:add} as unknown as Window;Object.defineProperty(child,'parent',{value:child});installStagingInstallEscape(true,child);expect(add).not.toHaveBeenCalled();});
