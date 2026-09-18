import { describe, expect, it, vi } from 'vitest';
import { createTextGuardStore } from './TextGuardStore';
describe('synchronous text navigation authority', () => {
  it('publishes a frozen snapshot before same-stack listeners and preserves unchanged identity', () => {
    const store=createTextGuardStore(), context=store.beginContext(), initial=store.getSnapshot();
    const seen: unknown[]=[];store.subscribe(()=>seen.push(store.getSnapshot()));
    context.report({dirty:true,busy:false});const changed=store.getSnapshot();
    expect(seen).toEqual([changed]);expect(changed).toEqual({dirty:true,busy:false});expect(Object.isFrozen(changed)).toBe(true);
    expect(changed).not.toBe(initial);context.report({dirty:true,busy:false});expect(store.getSnapshot()).toBe(changed);expect(seen).toHaveLength(1);
    context.report({dirty:false,busy:true});expect(store.getSnapshot()).toEqual({dirty:false,busy:true});
  });
  it('supersedes old generations and invalidates only the active context', () => {
    const store=createTextGuardStore(), old=store.beginContext();old.report({dirty:true,busy:true});
    const current=store.beginContext();expect(store.getSnapshot()).toEqual({dirty:false,busy:false});
    current.report({dirty:true,busy:false});old.report({dirty:false,busy:true});old.invalidate();expect(store.getSnapshot()).toEqual({dirty:true,busy:false});
    current.invalidate();current.report({dirty:true,busy:true});expect(store.getSnapshot()).toEqual({dirty:false,busy:false});
  });
  it('isolates throwing subscribers and supports idempotent unsubscribe', () => {
    const store=createTextGuardStore(), context=store.beginContext(), last=vi.fn();
    store.subscribe(()=>{throw Error('private observer error');});const off=store.subscribe(last);
    expect(()=>context.report({dirty:true,busy:false})).not.toThrow();expect(last).toHaveBeenCalledTimes(1);
    off();off();context.report({dirty:false,busy:true});expect(last).toHaveBeenCalledTimes(1);expect(store.getSnapshot().busy).toBe(true);
  });
  it('disposes permanently fail closed and notifies before removing listeners', () => {
    const store=createTextGuardStore(), context=store.beginContext(), seen: unknown[]=[];store.subscribe(()=>seen.push(store.getSnapshot()));
    store.dispose();expect(seen).toEqual([{dirty:false,busy:true}]);const final=store.getSnapshot();
    context.report({dirty:true,busy:false});context.invalidate();store.dispose();expect(store.getSnapshot()).toBe(final);
    expect(()=>store.beginContext()).toThrow('TEXT_GUARD_DISPOSED');expect(()=>store.subscribe(()=>{})).toThrow('TEXT_GUARD_DISPOSED');
  });
  it('retains newer authority when a notification starts another context', () => {
    const store=createTextGuardStore(), old=store.beginContext();let once=true;
    store.subscribe(()=>{if(once){once=false;store.beginContext();}});
    old.report({dirty:true,busy:true});old.report({dirty:true,busy:true});expect(store.getSnapshot()).toEqual({dirty:false,busy:false});
  });
});
