import { expect, it, vi } from 'vitest';
import { parseFieldAnswersV3 as parse } from '../src/fieldAnswersV3';
import { parseFieldAnswersV2 } from '../src/fieldAnswersV2';

const choice = (extra = {}) => ({key:'package',kind:'dropdown',required:false,choices:[{id:'standard',label:'Standard'},{id:'premium',label:'Premium'}],...extra});
const text = (extra = {}) => ({key:'notes',kind:'text',required:false,minLength:0,maxLength:4096,...extra});
const doc = (fields:unknown[]) => ({schemaVersion:3,fields});
const answers = (values:unknown[]) => ({schemaVersion:3,answers:values});
const a = (key:string,value:unknown) => ({key,value});
const reject = (d:unknown,value:unknown) => expect(() => parse(d,value)).toThrow('INVALID_FIELD_V3_CONTRACT');

it('accepts exact stable option IDs and enforces required dropdowns', () => {
  const d=doc([choice({required:true})]);
  expect(parse(d,answers([a('package','premium')])).answers).toEqual([a('package','premium')]);
  for(const value of ['','Premium','PREMIUM',' premium','premium ','unknown',null,[],1]) reject(d,answers([a('package',value)]));
  reject(d,answers([]));
  expect(parse(doc([choice()]),answers([])).answers).toEqual([]);
  reject(doc([choice()]),answers([a('package','')]));
});

it('copies and freezes answers without normalizing values or changing input order', () => {
  const input=answers([a('notes',' e\u0301 '),a('package','standard')]);
  const out=parse(doc([choice(),text()]),input);
  expect(out.answers).toEqual(input.answers);
  (input.answers[0] as {value:unknown}).value='changed';
  expect(out.answers[0]?.value).toBe(' e\u0301 ');
  expect(Object.isFrozen(out)).toBe(true);
  expect(Object.isFrozen(out.answers)).toBe(true);
  expect(Object.isFrozen(out.answers[0])).toBe(true);
});

it('rejects unknown or duplicate fields and caller supplied commerce or authority', () => {
  const d=doc([choice()]);
  for(const rows of [[a('foreign','standard')],[a('package','standard'),a('package','premium')],[{...a('package','standard'),price:1}],[{...a('package','standard'),tenantId:'foreign'}]]) reject(d,answers(rows));
  reject(d,{...answers([]),default:'standard'});
  reject(d,{...answers([]),paymentStatus:'paid'});
});

it('rejects prototypes, symbols, sparse lists and accessors without invoking them', () => {
  const d=doc([choice()]),getter=vi.fn();
  const row=Object.defineProperty(a('package','standard'),'value',{enumerable:true,get:getter});
  reject(d,answers([row]));expect(getter).not.toHaveBeenCalled();
  for(const rows of [new Array(1),Object.assign([a('package','standard')],{extra:1}),[Object.assign(a('package','standard'),{[Symbol()]:1})],[Object.create(a('package','standard'))]]) reject(d,answers(rows));
  reject(d,new Proxy({},{ownKeys(){throw Error('private');}}));
});

it('preserves V2 text and textarea validation semantics', () => {
  for(const kind of ['text','textarea']) for(const value of ['hello','e\u0301','a\nb','a\rb','a\r\nb','a\u2028b','a\u2029b','\0','\ud800']) {
    const fields=[text({kind})],v2={schemaVersion:2,fields};
    let accepted=true;
    try {parseFieldAnswersV2(v2,{schemaVersion:2,answers:[a('notes',value)]});} catch {accepted=false;}
    if(accepted) expect(parse(doc(fields),answers([a('notes',value)])).answers[0]?.value).toBe(value);
    else reject(doc(fields),answers([a('notes',value)]));
  }
});

it('enforces codepoint limits, exact CRLF counting and required whitespace rules', () => {
  const d=doc([text({kind:'textarea',required:true,minLength:2,maxLength:2})]);
  for(const value of ['😀😀','e\u0301']) expect(parse(d,answers([a('notes',value)])).answers[0]?.value).toBe(value);
  for(const value of ['😀😀😀','a\r\n','  ']) reject(d,answers([a('notes',value)]));
  expect(parse(doc([text({kind:'textarea',maxLength:2})]),answers([a('notes','\r\n')])).answers[0]?.value).toBe('\r\n');
});

it('counts dropdown IDs in the global UTF16 budget and rejects other envelopes', () => {
  const fields=Array.from({length:8},(_,i)=>text({key:`t${i}`,kind:'textarea'}));
  const rows=fields.map(f=>a(f.key,'😀'.repeat(4096)));
  const d=doc([...fields,choice()]);
  expect(parse(d,answers(rows)).answers).toHaveLength(8);
  reject(d,answers([...rows,a('package','standard')]));
  rows[0]=a('t0','😀'.repeat(4092));
  expect(parse(d,answers([...rows,a('package','standard')])).answers).toHaveLength(9);
  for(const schemaVersion of [1,2,4]) reject(doc([text()]),{schemaVersion,answers:[]});
  expect(()=>parseFieldAnswersV2(doc([text()]),answers([]))).toThrow();
  reject(doc([text()]),answers([a('notes','a'.repeat(4097))]));
});
