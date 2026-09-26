import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
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
it('offers retirement only for active available rows and requires an explicit confirmation',()=>{
 const onRetire=vi.fn();
 const view=render(<ShiftOverview snapshot={snapshot} canRetire onRetire={onRetire}/>);
 const rows=within(screen.getByRole('region',{name:'Recorded shifts'})).getAllByRole('listitem');
 expect(within(rows[0]!).getByText('Retire available shift')).toBeTruthy();
 expect(within(rows[1]!).getByText('Retire available shift')).toBeTruthy();
 expect(within(rows[2]!).queryByText('Retire available shift')).toBeNull();
 const names=screen.getAllByRole('button',{name:/Retire available shift for/}).map(button=>button.getAttribute('aria-label'));
 expect(names).toHaveLength(2);
 expect(new Set(names).size).toBe(2);
 expect(names[0]).toMatch(/Sam, .+ to .+ \(UTC\); record aaaaaaaa/);
 expect(names[1]).toContain('Zoë <script>alert(1)</script>');
 fireEvent.click(within(rows[0]!).getByText('Retire available shift'));
 expect(screen.getByText(/Retiring this recorded shift does not cancel bookings or release holds/).textContent).toContain('Sam');
 fireEvent.click(screen.getByText('Cancel'));
 expect(onRetire).not.toHaveBeenCalled();
 fireEvent.click(within(rows[0]!).getByText('Retire available shift'));
 fireEvent.click(screen.getByText('Confirm retirement'));
 expect(onRetire).toHaveBeenCalledExactlyOnceWith(snapshot.shifts[2],1);
 expect(view.container.querySelector('input[type="datetime-local"]')).toBeNull();
});
it('requires confirmation for active blocked time off and refuses a changed record',()=>{
 const onRetire=vi.fn();const blocked={...snapshot.shifts[0]!,active:true};
 const view=render(<ShiftOverview snapshot={{...snapshot,shifts:[blocked]}} canRetire onRetire={onRetire}/>);
 const action=screen.getByRole('button',{name:/Retire blocked shift for Sam/});
 fireEvent.click(action);expect(screen.getByText('Retire blocked time off?')).toBeTruthy();
 expect(screen.getByText(/does not cancel bookings or release holds. Booking availability is managed separately/)).toBeTruthy();
 fireEvent.click(screen.getByText('Cancel'));expect(onRetire).not.toHaveBeenCalled();
 fireEvent.click(action);
 view.rerender(<ShiftOverview snapshot={{...snapshot,shifts:[{...blocked,active:false}]}} canRetire onRetire={onRetire}/>);
 expect(screen.getByText('Confirm retirement')).toBeDisabled();expect(onRetire).not.toHaveBeenCalled();
 view.rerender(<ShiftOverview snapshot={{...snapshot,shifts:[blocked]}} canRetire onRetire={onRetire}/>);
 fireEvent.click(screen.getByText('Confirm retirement'));
 expect(onRetire).toHaveBeenCalledExactlyOnceWith(blocked,snapshot.rosterVersion);
});
it('disables a pending blocked retirement when recorded details change within the same version',()=>{
 const onRetire=vi.fn();const blocked={...snapshot.shifts[0]!,active:true};
 const view=render(<ShiftOverview snapshot={{...snapshot,shifts:[blocked]}} canRetire onRetire={onRetire}/>);
 fireEvent.click(screen.getByText('Retire blocked time off'));
 view.rerender(<ShiftOverview snapshot={{...snapshot,shifts:[{...blocked,endsAt:'2030-01-02T12:00:00.000002Z'}]}} canRetire onRetire={onRetire}/>);
 expect(screen.getByText('Confirm retirement')).toBeDisabled();
 expect(screen.getByText('This shift changed. Refresh and review the roster before trying again.')).toBeTruthy();
 expect(onRetire).not.toHaveBeenCalled();
});
it('fails closed when the accepted snapshot changes while confirmation is open',()=>{
 const onRetire=vi.fn();const view=render(<ShiftOverview snapshot={snapshot} canRetire onRetire={onRetire}/>);
 fireEvent.click(within(screen.getAllByRole('listitem')[0]!).getByText('Retire available shift'));
 view.rerender(<ShiftOverview snapshot={{...snapshot,rosterVersion:2}} canRetire onRetire={onRetire}/>);
 expect(screen.getByText('This shift changed. Refresh and review the roster before trying again.')).toBeTruthy();
 expect(screen.getByText('Confirm retirement')).toBeDisabled();
 expect(onRetire).not.toHaveBeenCalled();
});
