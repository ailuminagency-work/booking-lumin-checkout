// @vitest-environment jsdom
import {useInsertionEffect} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FieldQuestionPreviewV2} from './FieldQuestionPreviewV2';
const doc=(extra={})=>({schemaVersion:2,fields:[{key:'question',kind:'textarea',prompt:'Question',required:true,minLength:1,maxLength:4,...extra}]});
const check=()=>fireEvent.click(screen.getByRole('button',{name:'Check answers'}));
const enter=(value:string)=>fireEvent.change(screen.getByLabelText('Question'),{target:{value}});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('rejects cross-version, unknown-kind and hostile definitions without retaining controls',()=>{
 const getter=vi.fn();const accessor=Object.defineProperty({},'schemaVersion',{get:getter,enumerable:true}),view=render(<FieldQuestionPreviewV2 definition={doc()}/>);
 for(const bad of [{...doc(),schemaVersion:1},doc({kind:'select'}),doc({key:'__proto__'}),accessor,new Proxy({},{getPrototypeOf(){throw new Error('private');}})]) {view.rerender(<FieldQuestionPreviewV2 definition={bad}/>);expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();}expect(getter).not.toHaveBeenCalled();
});
it.each(['reset','definition'])('clears answers and validation status before %s replacement commits',kind=>{
 const snapshots:{values:string[];status:string|null}[]=[],first={},next={};
 function Probe({definition,resetKey}:{definition:unknown;resetKey:object}){useInsertionEffect(()=>{snapshots.push({values:[...document.querySelectorAll('input,textarea')].map(e=>(e as HTMLInputElement).value),status:document.querySelector('[role="status"]')?.textContent??null});});return <FieldQuestionPreviewV2 definition={definition} resetKey={resetKey}/>;}
 const view=render(<Probe definition={doc()} resetKey={first}/>);enter('abcd');check();expect(screen.getByRole('status')).toBeTruthy();snapshots.length=0;view.rerender(<Probe definition={kind==='definition'?doc({prompt:'Changed'}):doc()} resetKey={kind==='reset'?next:first}/>);expect(snapshots).toEqual([{values:[''],status:null}]);
});
it('handles valid prototype-like keys independently and escapes labels',()=>{
 const fields=['toString','valueOf'].map(key=>({...doc().fields[0]!,key,prompt:'<img src=x onerror=alert(1)>'}));const view=render(<FieldQuestionPreviewV2 definition={{schemaVersion:2,fields}}/>);const controls=screen.getAllByRole('textbox');expect(controls).toHaveLength(2);expect(controls[0]!.id).not.toBe(controls[1]!.id);for(const c of controls)expect((c as HTMLTextAreaElement).value).toBe('');expect(view.container.querySelector('img')).toBeNull();fireEvent.change(controls[0]!,{target:{value:'one'}});fireEvent.change(controls[1]!,{target:{value:'two'}});check();expect(screen.getByRole('status')).toBeTruthy();
});
it('uses codepoint validation for textarea newlines without Unicode normalization',()=>{
 render(<FieldQuestionPreviewV2 definition={doc({maxLength:3})}/>);for(const value of ['🌍\n🌍','e\u0301\n','a\u2028b','a\u2029b']){enter(value);check();expect(screen.queryByRole('alert')).toBeNull();expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe(value);}enter('🌍\n🌍x');check();expect(screen.getByRole('alert')).toBeTruthy();
});
it('text Enter cannot submit while textarea Enter remains available without named form fields',()=>{
 const fetcher=vi.fn(),submit=vi.fn((e:React.FormEvent)=>e.preventDefault());vi.stubGlobal('fetch',fetcher);const fields=[{...doc().fields[0]!,kind:'text',prompt:'Short'},{...doc().fields[0]!,key:'long',prompt:'Long'}];const view=render(<form onSubmit={submit}><FieldQuestionPreviewV2 definition={{schemaVersion:2,fields}}/></form>);const short=screen.getByLabelText('Short'),long=screen.getByLabelText('Long');expect(short.tagName).toBe('INPUT');expect(long.tagName).toBe('TEXTAREA');expect(fireEvent.keyDown(short,{key:'Enter',cancelable:true})).toBe(false);expect(fireEvent.keyDown(long,{key:'Enter',cancelable:true})).toBe(true);check();expect(submit).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();expect([...new FormData(view.container.querySelector('form')!).entries()]).toEqual([]);for(const el of [short,long])for(const name of ['name','required','minlength','maxlength','form'])expect(el.hasAttribute(name)).toBe(false);
});
it('validation rejects forbidden controls and preserves exact visible input without transport',()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);render(<FieldQuestionPreviewV2 definition={doc()}/>);enter('\u0000');check();expect(screen.getByRole('alert')).toBeTruthy();enter(' ');check();expect(screen.getByRole('alert')).toBeTruthy();enter('abcd');check();expect(screen.getByRole('status')).toBeTruthy();expect(fetcher).not.toHaveBeenCalled();
});
it('enforces aggregate UTF16 budget while rejecting oversized edits without truncating prior value',()=>{
 const fields=Array.from({length:9},(_,i)=>({...doc().fields[0]!,key:`q${i}`,prompt:`Question ${i}`,required:false,minLength:0,maxLength:4096}));render(<FieldQuestionPreviewV2 definition={{schemaVersion:2,fields}}/>);
 const full='🌍'.repeat(4096);for(let i=0;i<8;i++)fireEvent.change(screen.getByLabelText(`Question ${i}`),{target:{value:full}});check();expect(screen.getByRole('status')).toBeTruthy();fireEvent.change(screen.getByLabelText('Question 8'),{target:{value:'x'}});expect((screen.getByLabelText('Question 8') as HTMLTextAreaElement).value).toBe('');fireEvent.change(screen.getByLabelText('Question 0'),{target:{value:''}});fireEvent.change(screen.getByLabelText('Question 8'),{target:{value:'x'}});fireEvent.change(screen.getByLabelText('Question 8'),{target:{value:'x'.repeat(8193)}});expect((screen.getByLabelText('Question 8') as HTMLTextAreaElement).value).toBe('x');
});
