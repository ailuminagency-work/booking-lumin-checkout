import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {CopyInstallationSnippet} from './CopyInstallationSnippet';

const props={label:'Website iframe code',value:'<iframe src="https://booking.example.test"></iframe>',selection:'tenant-a:version-1',rows:5};
function clipboard(writeText:ReturnType<typeof vi.fn>|undefined){Object.defineProperty(navigator,'clipboard',{configurable:true,value:writeText?{writeText}:undefined});}
afterEach(()=>{cleanup();vi.restoreAllMocks();clipboard(undefined);});
it('copies only after an explicit accessible action and retains the selectable readonly fallback',async()=>{
 const write=vi.fn().mockResolvedValue(undefined);clipboard(write);render(<CopyInstallationSnippet {...props}/>);
 expect(write).not.toHaveBeenCalled();const field=screen.getByLabelText(props.label);expect(field).toHaveAttribute('readonly');expect(field).toHaveValue(props.value);field.focus();expect(field).toHaveFocus();
 const button=screen.getByRole('button',{name:'Copy Website iframe code'});button.focus();expect(button).toHaveFocus();fireEvent.click(button);
 expect(await screen.findByText('Copied Website iframe code.')).toBeTruthy();expect(write).toHaveBeenCalledExactlyOnceWith(props.value);expect(field).toHaveValue(props.value);expect(document.querySelector('iframe')).toBeNull();
});
it.each(['absent','method'] as const)('offers manual copying when clipboard is unavailable: %s',async mode=>{
 clipboard(undefined);if(mode==='method')Object.defineProperty(navigator,'clipboard',{configurable:true,value:{}});render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));expect(await screen.findByRole('status')).toHaveTextContent('Clipboard is unavailable');expect(screen.getByLabelText(props.label)).toHaveValue(props.value);
});
it.each(['reject','throw','getter'] as const)('reports denied access without leaking raw errors: %s',async mode=>{
 const secret='private-browser-error';const write=mode==='reject'?vi.fn().mockRejectedValue(Error(secret)):vi.fn(()=>{throw Error(secret);});clipboard(write);if(mode==='getter')Object.defineProperty(navigator,'clipboard',{configurable:true,get(){throw Error(secret);}});
 render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));expect(await screen.findByText(/Could not copy Website iframe code/)).toBeTruthy();expect(document.body.textContent).not.toContain(secret);expect(screen.getByLabelText(props.label)).toHaveValue(props.value);expect(screen.getByRole('button',{name:'Copy Website iframe code'})).toBeEnabled();
});
it.each(['selection','value'] as const)('clears copied feedback when %s changes without automatic clipboard writes',async field=>{
 const write=vi.fn().mockResolvedValue(undefined);clipboard(write);const view=render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));await screen.findByText('Copied Website iframe code.');view.rerender(<CopyInstallationSnippet {...props} {...{[field]:field==='selection'?'tenant-b:version-1':'new code'}}/>);expect(screen.queryByRole('status')).toBeNull();expect(write).toHaveBeenCalledTimes(1);
});
it('ignores stale resolution after reselection even when returning to the same receipt',async()=>{
 let finish!:()=>void;const write=vi.fn(()=>new Promise<void>(resolve=>finish=resolve));clipboard(write);const view=render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));expect(screen.getByRole('button',{name:'Copy Website iframe code'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));expect(write).toHaveBeenCalledTimes(1);
 view.rerender(<CopyInstallationSnippet {...props} selection="tenant-b:version-2"/>);view.rerender(<CopyInstallationSnippet {...props}/>);await act(async()=>finish());expect(screen.queryByRole('status')).toBeNull();expect(screen.getByRole('button',{name:'Copy Website iframe code'})).toBeEnabled();expect(write).toHaveBeenCalledTimes(1);
});
it('ignores stale failures after unmount and does not affect a newly mounted copy action',async()=>{
 let reject!:(reason:Error)=>void;const write=vi.fn().mockImplementationOnce(()=>new Promise<void>((_,r)=>reject=r)).mockResolvedValue(undefined);clipboard(write);const view=render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));view.unmount();render(<CopyInstallationSnippet {...props}/>);await act(async()=>reject(Error('private')));expect(screen.queryByRole('status')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));await screen.findByText('Copied Website iframe code.');expect(write).toHaveBeenCalledTimes(2);
});
it.each(['','x'.repeat(8193)])('does not write an unavailable or oversized snippet',value=>{const write=vi.fn();clipboard(write);render(<CopyInstallationSnippet {...props} value={value}/>);expect(screen.getByRole('button',{name:'Copy Website iframe code'})).toBeDisabled();expect(screen.getByLabelText(props.label)).toHaveValue('');fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));expect(write).not.toHaveBeenCalled();});


it.each([undefined,5])('selects the exact readonly current text without writing to clipboard (rows=%s)',rows=>{
 const write=vi.fn();clipboard(write);render(<CopyInstallationSnippet {...props} rows={rows}/>);const input=screen.getByLabelText(props.label) as HTMLInputElement|HTMLTextAreaElement;
 fireEvent.click(screen.getByRole('button',{name:'Select Website iframe code'}));expect(input).toHaveFocus();expect(input.selectionStart).toBe(0);expect(input.selectionEnd).toBe(props.value.length);expect(screen.getByRole('status')).toHaveTextContent('Selected Website iframe code. Use your device copy command to copy it.');expect(screen.queryByText('Copied Website iframe code.')).toBeNull();expect(write).not.toHaveBeenCalled();expect(document.querySelector('iframe')).toBeNull();
});
it('supports manual selection after clipboard denial and clears feedback on receipt replacement',async()=>{
 const write=vi.fn().mockRejectedValue(Error('private'));clipboard(write);const view=render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));await screen.findByText(/Could not copy Website iframe code/);fireEvent.click(screen.getByRole('button',{name:'Select Website iframe code'}));expect(screen.getByRole('status')).toHaveTextContent('Selected Website iframe code.');expect(write).toHaveBeenCalledTimes(1);
 view.rerender(<CopyInstallationSnippet {...props} value="new readonly code" selection="tenant-b:version-2"/>);expect(screen.queryByRole('status')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Select Website iframe code'}));expect((screen.getByLabelText(props.label) as HTMLTextAreaElement).selectionEnd).toBe('new readonly code'.length);expect(write).toHaveBeenCalledTimes(1);
});
it('does not claim selection after a native selection failure or reflect raw errors',()=>{
 render(<CopyInstallationSnippet {...props}/>);const input=screen.getByLabelText(props.label) as HTMLTextAreaElement;vi.spyOn(input,'select').mockImplementation(()=>{throw Error('private-native-error');});fireEvent.click(screen.getByRole('button',{name:'Select Website iframe code'}));expect(screen.getByRole('status')).toHaveTextContent('Could not select Website iframe code. Select the text manually to copy it.');expect(document.body.textContent).not.toContain('private-native-error');
});
it('keeps manual selection disabled during an active copy and for invalid text',async()=>{
 let finish!:()=>void;clipboard(vi.fn(()=>new Promise<void>(resolve=>finish=resolve)));const view=render(<CopyInstallationSnippet {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Copy Website iframe code'}));const select=screen.getByRole('button',{name:'Select Website iframe code'});expect(select).toBeDisabled();fireEvent.click(select);expect(screen.getByRole('status')).toHaveTextContent('Copying Website iframe code');await act(async()=>finish());expect(select).toBeEnabled();view.rerender(<CopyInstallationSnippet {...props} value=""/>);expect(screen.getByRole('button',{name:'Select Website iframe code'})).toBeDisabled();
});
