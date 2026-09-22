import {describe,expect,it} from "vitest";
import fixture from "./fixtures/configurable-publication-v2.json";
import {normalizeConfigurablePublication as normalize,validateConfigurableAnswers as answers,ConfigurablePublicationError} from "../src/configurablePublication";
const fresh=()=>structuredClone(fixture);
function rejects(run:()=>unknown,code:string){try{run();throw Error("expected rejection");}catch(error){expect(error).toBeInstanceOf(ConfigurablePublicationError);expect((error as ConfigurablePublicationError).code).toBe(code);}}
describe("shared configurable publication V2 parity",()=>{
 for(const entry of fixture.cases)it(entry.name,()=>{const normalized=normalize(fixture.catalog,fixture.authoring);if("error"in entry)rejects(()=>answers(normalized.snapshot,entry.answers),entry.error!);else expect(answers(normalized.snapshot,entry.answers)).toEqual(entry.normalized);});
 it("projects isolated overrides and freezes source-independent snapshots",()=>{
  const f=fresh(),before=structuredClone(f.catalog);const value=normalize(f.catalog,f.authoring);expect(f.catalog).toEqual(before);
  const mode=value.snapshot.service.questions.find(q=>q.id==="mode")!,count=value.snapshot.service.questions.find(q=>q.id==="count")!;
  expect(mode.prompt).toBe(f.effective.prompts.mode);expect(mode.choices[1]!.label).toBe(f.effective.extraLabel);expect([count.minQty,count.maxQty]).toEqual(f.effective.countBounds);
  f.authoring.questionOverrides.mode.prompt="changed";f.catalog.questions[0]!.prompt="changed";expect(mode.prompt).toBe("Choose request mode");expect(Object.isFrozen(mode.choices[0])).toBe(true);expect(()=>Object.assign(mode,{required:false})).toThrow();
 });
 it("permits optional field removal only with no stale override or dependency",()=>{
  const f=fresh();f.authoring.config.steps=f.authoring.config.steps.filter(s=>s.questionKey!=="tags");expect(normalize(f.catalog,f.authoring).snapshot.service.questions.map(q=>q.id)).toEqual(["mode","count"]);
  f.authoring.config.steps=f.authoring.config.steps.filter(s=>s.questionKey!=="count");rejects(()=>normalize(f.catalog,f.authoring),"INVALID_OVERRIDE");delete (f.authoring.questionOverrides as any).count;expect(normalize(f.catalog,f.authoring).snapshot.service.questions.length).toBe(1);
 });
 it.each(["remove","optional","hidden"])("cannot weaken catalog required floor by %s",change=>{
  const f=fresh();if(change==="remove")f.authoring.config.steps=f.authoring.config.steps.filter(s=>s.questionKey!=="mode");else if(change==="optional")f.authoring.config.steps[0]!.required=false;else (f.authoring.config.steps[0] as any).visibleWhen={field:"tags",op:"includes",value:"a"};rejects(()=>normalize(f.catalog,f.authoring),"REQUIRED_FLOOR");
 });
 it("supports typed includes only on earlier unconditional multichoice",()=>{
  const f=fresh();f.authoring.config.steps[2]!.visibleWhen={field:"tags",op:"includes",value:"b"};const p=normalize(f.catalog,f.authoring).snapshot;
  expect(answers(p,{mode:{choiceIds:["basic"]},tags:{choiceIds:["b"]},count:{quantity:2}})).toEqual({mode:{choiceIds:["basic"]},tags:{choiceIds:["b"]},count:{quantity:2}});
  expect(answers(p,{mode:{choiceIds:["basic"]}})).toEqual({mode:{choiceIds:["basic"]}});
 });
 it.each([
  {field:"count",op:"eq",value:"extra"},{field:"later",op:"eq",value:"extra"},{field:"tags",op:"eq",value:"a"},{field:"mode",op:"includes",value:"basic"},{field:"mode",op:"eq",value:"foreign"}
 ])("rejects self/unknown/kind/choice dependency %j",condition=>{const f=fresh();(f.authoring.config.steps[2] as any).visibleWhen=condition;rejects(()=>normalize(f.catalog,f.authoring),"INVALID_DEPENDENCY");});
 it("rejects forward references and hidden source chains",()=>{
  const f=fresh();f.authoring.config.steps=[f.authoring.config.steps[0]!,f.authoring.config.steps[2]!,f.authoring.config.steps[1]!];f.authoring.config.steps[1]!.visibleWhen={field:"tags",op:"includes",value:"a"};rejects(()=>normalize(f.catalog,f.authoring),"INVALID_DEPENDENCY");
  const g=fresh();(g.authoring.config.steps[1] as any).visibleWhen={field:"mode",op:"eq",value:"extra"};g.authoring.config.steps[2]!.visibleWhen={field:"tags",op:"includes",value:"a"};rejects(()=>normalize(g.catalog,g.authoring),"INVALID_DEPENDENCY");
 });
 it.each([{minQty:0},{maxQty:11},{minQty:5,maxQty:4},{choiceLabels:{a:"bad"}},{minQty:Number.MAX_SAFE_INTEGER+1}])("rejects widening/wrong-kind unsafe override %j",override=>{const f=fresh();(f.authoring.questionOverrides as any).count=override;expect(()=>normalize(f.catalog,f.authoring)).toThrow(ConfigurablePublicationError);});
 it("rejects extra field IDs/choice IDs and price/state/internal payloads",()=>{
  for(const patch of [{newField:{prompt:"X"}},{mode:{choiceLabels:{unknown:"X"}}},{mode:{minQty:1}}]){const f=fresh();Object.assign(f.authoring.questionOverrides,patch);rejects(()=>normalize(f.catalog,f.authoring),"INVALID_OVERRIDE");}
  for(const key of ["paid","confirmed","price","tenantId","script"]){const f=fresh();(f.authoring as any)[key]="bad";rejects(()=>normalize(f.catalog,f.authoring),"INVALID_CONFIG");}
  const f=fresh();(f.authoring.config.steps[2] as any).visibleWhen={and:[{field:"mode",op:"eq",value:"extra"}]};rejects(()=>normalize(f.catalog,f.authoring),"INVALID_CONFIG");
 });
 it("rejects malformed/oversized/accessor/prototype inputs without invoking getter",()=>{
  const f=fresh();let called=false;Object.defineProperty(f.authoring,"secret",{enumerable:true,get(){called=true;throw Error("secret");}});rejects(()=>normalize(f.catalog,f.authoring),"INVALID_CONFIG");expect(called).toBe(false);
  const g=fresh();(g.authoring as any).big="x".repeat(65537);rejects(()=>normalize(g.catalog,g.authoring),"CONFIG_BUDGET");
  rejects(()=>normalize(fixture.catalog,JSON.parse('{"authoringVersion":2,"config":{"key":"x","steps":[]},"questionOverrides":{"__proto__":{}}}')),"INVALID_CONFIG");
 });
 it("never changes a V1 object or accepts author-supplied snapshot authority",()=>{
  const f=fresh();(f.authoring as any).authoringVersion=1;rejects(()=>normalize(f.catalog,f.authoring),"INVALID_CONFIG");
  const snapshot=normalize(fixture.catalog,fixture.authoring).snapshot;expect(snapshot.submissionMode).toBe("unconfirmed_request");expect(()=>answers({...snapshot,submissionMode:"confirmed"},{})).toThrow();
 });
});

it("rejects sparse or exotic arrays before any schema iteration",()=>{
 const f=fresh();(f.authoring.config as any).steps=new Array(1_000_000_000);rejects(()=>normalize(f.catalog,f.authoring),"CONFIG_BUDGET");
 const g=fresh();(g.authoring.config as any).steps=new Array(3);rejects(()=>normalize(g.catalog,g.authoring),"INVALID_CONFIG");
 const h=fresh();let read=false;Object.defineProperty(h.authoring.config.steps,"0",{enumerable:false,get(){read=true;throw Error("no");}});rejects(()=>normalize(h.catalog,h.authoring),"INVALID_CONFIG");expect(read).toBe(false);
 const j=fresh();Object.setPrototypeOf(j.authoring.config.steps,{});rejects(()=>normalize(j.catalog,j.authoring),"INVALID_CONFIG");
 for(const key of [Symbol("hidden"),"hidden"]){const k=fresh();Object.defineProperty(k.authoring,key,{value:"private",enumerable:false});rejects(()=>normalize(k.catalog,k.authoring),"INVALID_CONFIG");}
});
it("normalizes Unicode choice IDs by pinned catalog order, never collation",()=>{
 const f=fresh();f.catalog.questions[1]!.choices=[{id:"😀",label:"Emoji"},{id:"é",label:"Accent"},{id:"中",label:"Han"}];const p=normalize(f.catalog,f.authoring).snapshot;
 expect(answers(p,{mode:{choiceIds:["basic"]},tags:{choiceIds:["中","é","😀"]}})).toEqual({mode:{choiceIds:["basic"]},tags:{choiceIds:["😀","é","中"]}});
});

for(const entry of fixture.includesCases)it(`shared SQL includes fixture: ${entry.name}`,()=>{
 const f=fresh();f.authoring.config.steps[2]!.visibleWhen={field:"tags",op:"includes",value:"b"};expect(answers(normalize(f.catalog,f.authoring).snapshot,entry.answers)).toEqual(entry.normalized);
});
it("shared SQL Unicode catalog ordinal fixture",()=>{
 const f=fresh();f.catalog.questions[1]!.choices=fixture.unicodeChoiceOrder.catalog.map(id=>({id,label:id}));
 const normalized=answers(normalize(f.catalog,f.authoring).snapshot,{mode:{choiceIds:["basic"]},tags:{choiceIds:fixture.unicodeChoiceOrder.input}});
 expect(normalized.tags).toEqual({choiceIds:fixture.unicodeChoiceOrder.normalized});
});

for(const boundary of fixture.utf16Boundaries)it(`shared SQL UTF16 boundary: ${boundary.target}`,()=>{
 const good=fresh(),bad=fresh();const valid=boundary.character.repeat(boundary.validRepeat),invalid=boundary.character.repeat(boundary.invalidRepeat);
 if(boundary.target==="prompt"){good.authoring.questionOverrides.mode.prompt=valid;bad.authoring.questionOverrides.mode.prompt=invalid;}else{good.authoring.questionOverrides.mode.choiceLabels.extra=valid;bad.authoring.questionOverrides.mode.choiceLabels.extra=invalid;}
 expect(()=>normalize(good.catalog,good.authoring)).not.toThrow();rejects(()=>normalize(bad.catalog,bad.authoring),"INVALID_CONFIG");
});

it("uses own properties for legitimate inherited-name choice and override IDs",()=>{
 const f=fresh();f.catalog.questions[0]!.choices=[...f.catalog.questions[0]!.choices,{id:"toString",label:"Safe label"}];f.authoring.questionOverrides.mode.choiceLabels={} as any;
 const p=normalize(f.catalog,f.authoring).snapshot;expect(p.service.questions[0]!.choices.find(c=>c.id==="toString")!.label).toBe("Safe label");
 f.catalog.questions[1]!.id="toString";f.authoring.config.steps[1]!.questionKey="toString";
 expect(normalize(f.catalog,f.authoring).snapshot.service.questions[1]!.prompt).toBe("Choose options");
});
it("missing optional inherited-name answers remain missing, including condition sources",()=>{
 const f=fresh();f.catalog.questions[1]!.id="hasOwnProperty";f.authoring.config.steps[1]!.questionKey="hasOwnProperty";f.authoring.config.steps[2]!.visibleWhen={field:"hasOwnProperty",op:"includes",value:"b"};
 const p=normalize(f.catalog,f.authoring).snapshot;
 expect(answers(p,{mode:{choiceIds:["basic"]}})).toEqual({mode:{choiceIds:["basic"]}});
 expect(answers(p,{mode:{choiceIds:["basic"]},hasOwnProperty:{choiceIds:["b"]},count:{quantity:3}})).toEqual({mode:{choiceIds:["basic"]},hasOwnProperty:{choiceIds:["b"]},count:{quantity:3}});
});
