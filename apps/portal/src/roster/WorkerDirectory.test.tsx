import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import type {RosterSnapshot} from '@lumin/flow-ui';
import {WorkerDirectory} from './WorkerDirectory';

const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222';
const snapshot={rosterVersion:3,workers:[{id:one,displayName:'Zoë <script>',active:true},{id:two,displayName:'Zoë <script>',active:false}],crews:[{id:'33333333-3333-4333-8333-333333333333',name:'Crew α',active:true,workerIds:[one]},{id:'55555555-5555-4555-8555-555555555555',name:'Past crew',active:false,workerIds:[one]}],eligibility:[{workerId:one,serviceId:'44444444-4444-4444-8444-444444444444',active:true}],services:[{id:'44444444-4444-4444-8444-444444444444',name:'Consultation',active:false}],shifts:[]} as RosterSnapshot;
afterEach(cleanup);
it('filters Unicode and retired workers without interpreting markup or collapsing duplicate names',()=>{
 const view=vi.fn();const {container}=render(<WorkerDirectory snapshot={snapshot} phase="ready" selectedId="" navigationBlocked={false} onView={view}/>);
 expect(container.querySelector('script')).toBeNull();expect(screen.getAllByText('Zoë <script>')).toHaveLength(2);
 const rows=screen.getAllByRole('listitem');expect(within(rows[0]!).getByText('Crews: Crew α, Past crew (retired crew)')).toBeTruthy();expect(within(rows[0]!).getByText('Service eligibility: Consultation (inactive service)')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Worker status'),{target:{value:'retired'}});expect(screen.getAllByRole('listitem')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'View worker Zoë <script>'}));expect(view).toHaveBeenCalledWith(two);
 fireEvent.change(screen.getByLabelText('Search workers'),{target:{value:'NOT FOUND'}});expect(screen.getByText('No workers match this search and status.')).toBeTruthy();
});
it('blocks navigation for unsaved edits and renders bounded non-ready states without roster data',()=>{
 const view=vi.fn();const {rerender}=render(<WorkerDirectory snapshot={snapshot} phase="ready" selectedId="" navigationBlocked onView={view}/>);
 expect(screen.getAllByRole('button',{name:/View worker/}).every(b=>(b as HTMLButtonElement).disabled)).toBe(true);
 expect(screen.getByText(/Save or discard the current worker edits/)).toBeTruthy();
 for(const phase of ['loading','blocked','denied','uninitialized','unavailable'] as const){rerender(<WorkerDirectory snapshot={snapshot} phase={phase} selectedId="" navigationBlocked={false} onView={view}/>);expect(screen.queryByText('Zoë <script>')).toBeNull();expect(screen.queryByLabelText('Search workers')).toBeNull();}
 expect(view).not.toHaveBeenCalled();
});
it('distinguishes an empty roster from a filtered empty result',()=>{
 render(<WorkerDirectory snapshot={{...snapshot,workers:[]}} phase="ready" selectedId="" navigationBlocked={false} onView={vi.fn()}/>);
 expect(screen.getByText('No workers have been added.')).toBeTruthy();expect(screen.queryByText('No workers match this search and status.')).toBeNull();
});
it('joins mixed-case UUID references in both directions without attaching unrelated records',()=>{
 const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', serviceId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const mixed={...snapshot,workers:[{id:first.toUpperCase(),displayName:'First',active:true},{id:second,displayName:'Second',active:true}],crews:[{id:one,name:'Matching crew',active:true,workerIds:[first]},{id:two,name:'Other crew',active:true,workerIds:[second.toUpperCase()]}],services:[{id:serviceId,name:'Matching service',active:true}],eligibility:[{workerId:first,serviceId:serviceId.toUpperCase(),active:true},{workerId:second.toUpperCase(),serviceId:serviceId,active:false}]} as RosterSnapshot;
 render(<WorkerDirectory snapshot={mixed} phase="ready" selectedId="" navigationBlocked={false} onView={vi.fn()}/>);
 const rows=screen.getAllByRole('listitem');
 expect(within(rows[0]!).getByText('Crews: Matching crew')).toBeTruthy();
 expect(within(rows[0]!).getByText('Service eligibility: Matching service')).toBeTruthy();
 expect(within(rows[1]!).getByText('Crews: Other crew')).toBeTruthy();
 expect(within(rows[1]!).getByText('Service eligibility: None')).toBeTruthy();
});
