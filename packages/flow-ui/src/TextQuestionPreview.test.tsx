// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {TextQuestionPreview} from './TextQuestionPreview';
const doc=(extra={})=>({schemaVersion:1,fields:[{key:'notes',kind:'text',prompt:'Question',required:true,minLength:1,maxLength:2,...extra}]});
const check=()=>fireEvent.click(screen.getByRole('button',{name:'Check answers'}));
const enter=(value:string)=>fireEvent.change(screen.getByLabelText('Question'),{target:{value}});
const value=()=>(screen.getByLabelText('Question') as HTMLInputElement).value;
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('validates codepoints and required whitespace without native constraints',()=>{
 render(<TextQuestionPreview definition={doc()}/>);const input=screen.getByLabelText('Question');
 for(const name of ['required','maxlength','minlength','name','form'])expect(input.hasAttribute(name)).toBe(false);
 enter(' ');check();expect(screen.getByRole('alert')).toBeTruthy();expect(input.getAttribute('aria-invalid')).toBe('true');enter('\u{1f600}\u{1f600}');check();expect(screen.getByRole('status')).toBeTruthy();
 enter('e\u0301x');check();expect(screen.getByRole('alert')).toBeTruthy();
});
it('accepts optional whitespace exactly but enforces max0',()=>{
 const view=render(<TextQuestionPreview definition={doc({required:false,minLength:2,maxLength:8})}/>);check();expect(screen.getByRole('status')).toBeTruthy();
 enter('  ');check();expect(value()).toBe('  ');expect(screen.getByRole('status')).toBeTruthy();
 view.rerender(<TextQuestionPreview definition={doc({required:false,minLength:0,maxLength:0})}/>);check();expect(screen.getByRole('status')).toBeTruthy();enter(' ');check();expect(screen.getByRole('alert')).toBeTruthy();
});
it('resets definition/context changes but preserves equivalent definitions',()=>{
 const first={},second={};const view=render(<TextQuestionPreview definition={doc()} resetKey={first}/>);enter('ab');check();
 view.rerender(<TextQuestionPreview definition={doc()} resetKey={first}/>);expect(value()).toBe('ab');
 view.rerender(<TextQuestionPreview definition={doc()} resetKey={second}/>);expect(value()).toBe('');expect(screen.queryByRole('status')).toBeNull();
 enter('ab');view.rerender(<TextQuestionPreview definition={doc({maxLength:3})} resetKey={second}/>);expect(value()).toBe('');
});
it('rejects getters without invocation or stale answers',()=>{
 let reads=0;const invalid=Object.defineProperty({},'schemaVersion',{get(){reads++;return 1;},enumerable:true});
 const view=render(<TextQuestionPreview definition={doc()}/>);enter('ab');view.rerender(<TextQuestionPreview definition={invalid}/>);
 expect(reads).toBe(0);expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();
 view.rerender(<TextQuestionPreview definition={doc()}/>);expect(value()).toBe('');
});
it('escapes markup, uniquely labels duplicates, avoids form submission and I/O',()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const definition=doc({prompt:'<img src=x>',maxLength:100});definition.fields.push({...definition.fields[0]!,key:'other'});
 const view=render(<form data-testid="outer"><TextQuestionPreview definition={definition}/></form>);
 const controls=screen.getAllByRole('textbox');expect(controls[0]!.id).not.toBe(controls[1]!.id);expect(screen.getAllByLabelText('<img src=x>')).toHaveLength(2);expect(view.container.querySelector('img')).toBeNull();
 expect(fireEvent.keyDown(controls[0]!,{key:'Enter',code:'Enter',cancelable:true})).toBe(false);
 const form=screen.getByTestId('outer') as HTMLFormElement;expect(form.checkValidity()).toBe(true);expect([...new FormData(form).entries()]).toEqual([]);check();expect(fetcher).not.toHaveBeenCalled();
 const old=doc();delete (old.fields[0] as {prompt?:string}).prompt;view.rerender(<TextQuestionPreview definition={old}/>);expect(screen.getByLabelText('Question needs a label')).toBeTruthy();
});
it('bounds local input at8192 units',()=>{render(<TextQuestionPreview definition={doc({maxLength:4096})}/>);enter('a'.repeat(8193));expect(value()).toBe('');});
it('valid inherited property names start empty and retain entered strings',()=>{render(<TextQuestionPreview definition={doc({key:'toString'})}/>);expect(value()).toBe('');enter('ab');check();expect(value()).toBe('ab');expect(screen.getByRole('status')).toBeTruthy();});
