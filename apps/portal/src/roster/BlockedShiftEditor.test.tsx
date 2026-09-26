import {fireEvent,render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {BlockedShiftEditor,uniqueWallMinute} from './BlockedShiftEditor';

const worker='22222222-2222-4222-8222-222222222222';
const snapshot={rosterVersion:4,workers:[{id:worker,displayName:'Sam',active:true}],crews:[],eligibility:[],shifts:[],services:[]};
afterEach(cleanup);

it('resolves unique wall minutes and rejects daylight-saving gaps and folds',()=>{
 expect(uniqueWallMinute('2026-01-01T09:00','Asia/Kathmandu')).toBe('2026-01-01T03:15:00.000000Z');
 expect(uniqueWallMinute('2026-03-08T02:30','America/Los_Angeles')).toBeNull();
 expect(uniqueWallMinute('2026-11-01T01:30','America/Los_Angeles')).toBeNull();
 expect(uniqueWallMinute('2026-03-08T03:30','America/Los_Angeles')).toBe('2026-03-08T10:30:00.000000Z');
 expect(uniqueWallMinute('2026-02-30T10:00','UTC')).toBeNull();
 expect(uniqueWallMinute('2026-01-01T09:00','Not/A_Zone')).toBeNull();
});

it('submits only active-worker blocked time off with accepted version and resolves source zone',()=>{
 const onCreate=vi.fn();const view=render(<BlockedShiftEditor snapshot={snapshot} disabled={false} resetCounter={0} onCreate={onCreate}/>);
 fireEvent.click(screen.getByText('Record time off'));expect(onCreate).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Worker for time off'),{target:{value:worker}});
 fireEvent.change(screen.getByLabelText('Start local time'),{target:{value:'2026-01-01T09:00'}});
 fireEvent.change(screen.getByLabelText('End local time'),{target:{value:'2026-01-01T10:00'}});
 fireEvent.change(screen.getByLabelText('Time zone'),{target:{value:'Asia/Kathmandu'}});
 fireEvent.click(screen.getByText('Record time off'));
 expect(onCreate).toHaveBeenCalledWith({workerId:worker,startsAt:'2026-01-01T03:15:00.000000Z',endsAt:'2026-01-01T04:15:00.000000Z',sourceTimeZone:'Asia/Kathmandu'},4);
 view.rerender(<BlockedShiftEditor snapshot={{...snapshot,rosterVersion:5}} disabled={false} resetCounter={1} onCreate={onCreate}/>);
 expect(screen.getByLabelText('Worker for time off')).toHaveValue('');expect(screen.getByLabelText('Start local time')).toHaveValue('');expect(screen.getByLabelText('End local time')).toHaveValue('');
 fireEvent.click(screen.getByText('Record time off'));expect(onCreate).toHaveBeenCalledTimes(1);
});

it('keeps time-off editing unavailable when the roster has no active workers',()=>{
 render(<BlockedShiftEditor snapshot={{...snapshot,workers:[{...snapshot.workers[0]!,active:false}]}} disabled={false} resetCounter={0} onCreate={vi.fn()}/>);
 expect(screen.getByText('Add an active worker before recording time off.')).toBeTruthy();expect(screen.queryByText('Record time off')).toBeNull();
});
