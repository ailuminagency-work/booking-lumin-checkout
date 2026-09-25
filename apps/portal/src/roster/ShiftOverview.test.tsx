import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import type {RosterSnapshot} from '@lumin/flow-ui';
import {ShiftOverview} from './ShiftOverview';

const instant=(microseconds:string)=>`2030-01-02T10:00:00.${microseconds}Z`;
const snapshot: RosterSnapshot={rosterVersion:1,workers:[
 {id:'22222222-2222-4222-8222-222222222222',displayName:'Zoë <script>alert(1)</script>',active:true},
 {id:'33333333-3333-4333-8333-333333333333',displayName:'Sam',active:false},
],crews:[],eligibility:[],services:[],shifts:[
 {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',workerId:'33333333-3333-4333-8333-333333333333',kind:'blocked',startsAt:instant('000002'),endsAt:instant('100002'),sourceTimeZone:'UTC',active:false},
 {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',workerId:'22222222-2222-4222-8222-222222222222',kind:'available',startsAt:instant('000001'),endsAt:instant('100001'),sourceTimeZone:'posix/UTC',active:true},
 {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workerId:'33333333-3333-4333-8333-333333333333',kind:'available',startsAt:instant('000001'),endsAt:instant('100001'),sourceTimeZone:'UTC',active:true},
]};
afterEach(cleanup);

it('sorts exact UTC microsecond instants and uses ID to break ties',()=>{
 render(<ShiftOverview snapshot={snapshot}/>);
 const rows=within(screen.getByRole('region',{name:'Recorded shifts'})).getAllByRole('listitem');
 expect(rows).toHaveLength(3);
 expect(rows.map(row=>row.textContent?.match(/^(Sam|Zoë)/)?.[0])).toEqual(['Sam','Zoë','Sam']);
 expect(rows[0]?.textContent).toContain('Available · Active');
 expect(rows[2]?.textContent).toContain('Blocked · Retired');
 expect(rows[1]?.textContent).toContain('UTC display fallback; recorded zone: posix/UTC');
});

it('filters by worker name, kind and status without changing the accepted snapshot',()=>{
 render(<ShiftOverview snapshot={snapshot}/>);
 fireEvent.change(screen.getByLabelText('Search shift workers'),{target:{value:'sam'}});
 expect(screen.getAllByRole('listitem')).toHaveLength(2);
 fireEvent.change(screen.getByLabelText('Shift kind'),{target:{value:'blocked'}});
 expect(screen.getAllByRole('listitem')).toHaveLength(1);
 expect(screen.getByRole('listitem').textContent).toContain('Blocked · Retired');
 fireEvent.change(screen.getByLabelText('Shift status'),{target:{value:'active'}});
 expect(screen.getByText('No recorded shifts match these filters.')).toBeTruthy();
 expect(snapshot.shifts).toHaveLength(3);
});

it('renders names and zones as text and distinguishes empty from no match',()=>{
 const view=render(<ShiftOverview snapshot={snapshot}/>);
 expect(view.container.querySelector('script')).toBeNull();
 expect(screen.getByText('Zoë <script>alert(1)</script>')).toBeTruthy();
 expect(view.container.querySelector('button')).toBeNull();
 view.rerender(<ShiftOverview snapshot={{...snapshot,shifts:[]}}/>);
 expect(screen.getByText('No recorded shifts.')).toBeTruthy();
});
it('joins accepted worker and shift UUIDs without case-sensitive misses',()=>{
 const workerId='AaAaAaAa-aAaA-4aAa-8AaA-aAaAaAaAaAaA';
 render(<ShiftOverview snapshot={{...snapshot,workers:[{id:workerId,displayName:'Case worker',active:true}],shifts:[{...snapshot.shifts[0]!,workerId:workerId.toLowerCase()}]}}/>);
 expect(screen.getByRole('listitem').textContent).toContain('Case worker');
 fireEvent.change(screen.getByLabelText('Search shift workers'),{target:{value:'case worker'}});
 expect(screen.getByRole('listitem').textContent).toContain('Case worker');
 expect(screen.queryByText('Unknown worker')).toBeNull();
});
