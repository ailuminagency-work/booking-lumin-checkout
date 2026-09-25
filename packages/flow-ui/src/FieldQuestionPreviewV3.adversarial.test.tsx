// @vitest-environment jsdom
import {useInsertionEffect} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FieldQuestionPreviewV3} from './FieldQuestionPreviewV3';

const choices=()=>[{id:'first',label:'Same label'},{id:'second',label:'Same label'}];
const dropdown=(extra={})=>({key:'selection',kind:'dropdown',required:true,prompt:'Choice',choices:choices(),...extra});
const text=(extra={})=>({key:'notes',kind:'textarea',required:false,prompt:'Notes',minLength:0,maxLength:4096,...extra});
const definition=(extra={})=>({schemaVersion:3,fields:[text(),dropdown(extra)]});
const check=()=>fireEvent.click(screen.getByRole('button',{name:'Check answers'}));
const choose=(value:string)=>fireEvent.change(screen.getByLabelText('Choice'),{target:{value}});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it.each(['context','label','identifier','order','required'])('clears text, select and validation before %s changes commit',change=>{
 const snapshots:{values:string[];status:string|null}[]=[];
 function Probe({value,identity}:{value:unknown;identity:object}){
  useInsertionEffect(()=>{snapshots.push({values:[...document.querySelectorAll('input,textarea,select')].map(node=>(node as HTMLInputElement).value),status:document.querySelector('[role="status"]')?.textContent??null});});
  return <FieldQuestionPreviewV3 definition={value} resetKey={identity}/>;
 }
 const identity={},view=render(<Probe value={definition()} identity={identity}/>);
 fireEvent.change(screen.getByLabelText('Notes'),{target:{value:'private answer'}});choose('second');check();expect(screen.getByRole('status')).toBeTruthy();
 const modifications:Record<string,object>={context:{},label:{choices:[{id:'first',label:'Changed'},choices()[1]!] },identifier:{choices:[choices()[0]!,{id:'replacement',label:'Same label'}]},order:{choices:choices().reverse()},required:{required:false}};
 snapshots.length=0;view.rerender(<Probe value={definition(modifications[change])} identity={change==='context'?{}:identity}/>);
 expect(snapshots).toEqual([{values:['',''],status:null}]);
});

it('fails closed on version confusion, duplicate IDs, accessors and throwing proxies without retaining controls',()=>{
 const getter=vi.fn();const choice=Object.defineProperty({id:'first'},'label',{enumerable:true,get:getter});
 const accessor=Object.defineProperty({},'schemaVersion',{enumerable:true,get:getter});
 const view=render(<FieldQuestionPreviewV3 definition={definition()}/>);choose('second');
 for(const value of [{...definition(),schemaVersion:2},definition({choices:[choices()[0],choices()[0]]}),definition({choices:[choice]}),definition({kind:'radio'}),accessor,new Proxy({},{getPrototypeOf(){throw new Error('private detail');}})]){
  view.rerender(<FieldQuestionPreviewV3 definition={value}/>);expect(screen.queryByRole('combobox')).toBeNull();expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();expect(view.container.textContent).not.toContain('private detail');
 }
 expect(getter).not.toHaveBeenCalled();view.rerender(<FieldQuestionPreviewV3 definition={definition()}/>);expect((screen.getByLabelText('Choice') as HTMLSelectElement).value).toBe('');
});

it('keeps duplicate labels separate by exact IDs and rejects a forged DOM option',()=>{
 render(<FieldQuestionPreviewV3 definition={definition()}/>);const select=screen.getByLabelText('Choice') as HTMLSelectElement;
 expect([...select.options].filter(option=>option.textContent==='Same label').map(option=>option.value)).toEqual(['first','second']);
 choose('second');check();expect(select.value).toBe('second');expect(screen.getByRole('status')).toBeTruthy();
 const forged=document.createElement('option');forged.value='forged';forged.textContent='Same label';select.append(forged);choose('forged');check();
 expect(screen.queryByRole('status')).toBeNull();expect(screen.getByRole('alert')).toBeTruthy();expect(select.getAttribute('aria-invalid')).toBe('true');
 choose('first');check();expect(screen.getByRole('status')).toBeTruthy();
});

it('omits an unanswered optional dropdown and never substitutes labels or defaults',()=>{
 const view=render(<FieldQuestionPreviewV3 definition={definition({required:false})}/>);check();expect(screen.getByRole('status')).toBeTruthy();
 choose('second');choose('');check();expect(screen.getByRole('status')).toBeTruthy();
 view.rerender(<FieldQuestionPreviewV3 definition={definition()}/>);check();expect(screen.getByRole('alert')).toBeTruthy();expect((screen.getByLabelText('Choice') as HTMLSelectElement).value).toBe('');
});

it('escapes hostile metadata and isolates inherited-looking keys and repeated preview instances',()=>{
 const label='<img src=x onerror=alert(1)>',value={schemaVersion:3,fields:[dropdown({key:'toString',prompt:label,choices:[{id:'valueOf',label}]}),text({key:'valueOf',prompt:label})]};
 const view=render(<><FieldQuestionPreviewV3 definition={value}/><FieldQuestionPreviewV3 definition={value}/></>);
 const controls=screen.getAllByLabelText(label);expect(controls).toHaveLength(4);expect(new Set(controls.map(control=>control.id)).size).toBe(4);expect(view.container.querySelector('img')).toBeNull();
 for(const control of controls)expect((control as HTMLInputElement).value).toBe('');
 fireEvent.change(controls[0]!,{target:{value:'valueOf'}});expect((controls[2] as HTMLSelectElement).value).toBe('');
});

it('does not persist, request or submit preview answers through an enclosing form',()=>{
 const fetcher=vi.fn(),submit=vi.fn((event:React.FormEvent)=>event.preventDefault()),storage=vi.spyOn(Storage.prototype,'setItem');vi.stubGlobal('fetch',fetcher);
 const view=render(<form onSubmit={submit}><FieldQuestionPreviewV3 definition={{schemaVersion:3,fields:[text({kind:'text'}),dropdown()]}}/></form>);
 choose('first');fireEvent.change(screen.getByLabelText('Notes'),{target:{value:'private'}});expect(fireEvent.keyDown(screen.getByLabelText('Notes'),{key:'Enter',cancelable:true})).toBe(false);expect(fireEvent.keyDown(screen.getByLabelText('Choice'),{key:'Enter',cancelable:true})).toBe(false);check();
 expect(screen.getByRole('button',{name:'Check answers'}).getAttribute('type')).toBe('button');expect([...new FormData(view.container.querySelector('form')!).entries()]).toEqual([]);
 for(const control of [screen.getByLabelText('Notes'),screen.getByLabelText('Choice')])for(const attribute of ['name','form','required'])expect(control.hasAttribute(attribute)).toBe(false);
 expect(fetcher).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
});

it('bounds aggregate answers including choice IDs and preserves exact text after oversized edits',()=>{
 const fields=Array.from({length:8},(_,index)=>text({key:`notes${index}`,prompt:`Notes ${index}`}));
 render(<FieldQuestionPreviewV3 definition={{schemaVersion:3,fields:[...fields,dropdown({required:false})]}}/>);
 const full='\u{1f600}'.repeat(4096);for(let index=0;index<8;index++)fireEvent.change(screen.getByLabelText(`Notes ${index}`),{target:{value:full}});
 choose('first');expect((screen.getByLabelText('Choice') as HTMLSelectElement).value).toBe('');check();expect(screen.getByRole('status')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Notes 0'),{target:{value:'e\u0301\n'}});choose('second');check();expect(screen.getByRole('status')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Notes 0'),{target:{value:'x'.repeat(8193)}});expect((screen.getByLabelText('Notes 0') as HTMLTextAreaElement).value).toBe('e\u0301\n');
});
