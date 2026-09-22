import {expect,it} from 'vitest';
import {parseRosterSnapshot,RosterLabel,RosterShiftInput,rosterInstantMicros} from '../src/roster';
const w='a1000000-0000-4000-8000-000000000001';
const empty=()=>({rosterVersion:1,workers:[],crews:[],eligibility:[],shifts:[],services:[]});
it('preserves PostgreSQL codepoint/btrim semantics and legitimate empty service labels',()=>{expect(RosterLabel.parse('😀'.repeat(160))).toHaveLength(320);expect(RosterLabel.safeParse('😀'.repeat(161)).success).toBe(false);expect(RosterLabel.safeParse('   ').success).toBe(false);expect(RosterLabel.safeParse('\t').success).toBe(true);expect(parseRosterSnapshot({...empty(),services:[{id:w,name:'',active:false}]}).services[0]!.name).toBe('');});
it('keeps microseconds and rejects invalid dates/UTC year overflow',()=>{
 expect(rosterInstantMicros('2030-01-01T00:00:00.000002Z')!-rosterInstantMicros('2030-01-01T00:00:00.000001Z')!).toBe(1n);
 for(const s of ['2030-02-30T00:00:00Z','1900-02-29T00:00:00Z','0001-01-01T00:00:00+00:01','9999-12-31T23:59:59-00:01','2030-01-01T24:00:00Z'])expect(rosterInstantMicros(s)).toBeNull();
 expect(rosterInstantMicros('2000-02-29T00:00:00Z')).not.toBeNull();
 expect(RosterShiftInput.safeParse({expectedRosterVersion:1,workerId:w,kind:'available',startsAt:'2030-01-01T00:00:00.000001Z',endsAt:'2030-01-01T00:00:00.000002Z',sourceTimeZone:'PG-specific-zone',active:true}).success).toBe(true);
});
it('requires complete scoped references and denies private fields',()=>{expect(()=>parseRosterSnapshot({...empty(),worker_access:[]})).toThrow();expect(()=>parseRosterSnapshot({...empty(),eligibility:[{serviceId:w,workerId:w,active:true}]})).toThrow();expect(()=>parseRosterSnapshot({...empty(),workers:[{id:w,displayName:'A',active:true},{id:w,displayName:'B',active:true}]})).toThrow();});
it('rejects oversized/sparse/accessor snapshots before parsing',()=>{expect(()=>parseRosterSnapshot({...empty(),services:[{id:w,name:'x'.repeat(4097),active:true}]})).toThrow();expect(()=>parseRosterSnapshot({...empty(),shifts:Array(100000000)})).toThrow();const s=empty();Object.defineProperty(s,'hidden',{get(){throw Error('must not invoke');}});expect(()=>parseRosterSnapshot(s)).toThrow();});
it('rejects malformed PG strings and preserves valid named-zone snapshots without Intl gating',()=>{expect(RosterLabel.safeParse('\ud800').success).toBe(false);expect(RosterLabel.safeParse('\0').success).toBe(false);expect(parseRosterSnapshot({...empty(),workers:[{id:w,displayName:'Worker',active:true}],shifts:[{id:w,workerId:w,kind:'available',startsAt:'2030-01-01T00:00:00.000001Z',endsAt:'2030-01-01T00:00:00.000002Z',sourceTimeZone:'PG-specific-zone',active:true}]}).shifts).toHaveLength(1);});
