import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VersionedEditor } from './FlowPortal';
const child = vi.hoisted(() => ({ props: undefined as any }));
vi.mock('./ConfigurableEditor', () => ({ ConfigurableEditor: (props: any) => { child.props = props; return <p>Text child boundary</p>; } }));
const props = () => ({ client: { flows: vi.fn(async () => ({ flows: [] })) } as any, token: 'synthetic', tenant: 'synthetic', services: [], initialFlows: [] });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); child.props = undefined; });
const open = () => fireEvent.click(screen.getByText('Configurable questionnaires'));
const standard = () => fireEvent.click(screen.getByText('Standard questionnaires'));
it('defaults capability off, forwards explicit client and retains stable callback across outward identity changes', () => {
 const p = props(), client = {} as any, first = vi.fn(), second = vi.fn();
 const view = render(<VersionedEditor {...p} textDraftClient={client} onTextStateChange={first}/>); open();
 expect(child.props.textDraftEnabled).toBe(false); expect(child.props.textDraftClient).toBe(client);
 const report = child.props.onTextStateChange;
 view.rerender(<VersionedEditor {...p} textDraftClient={client} textDraftEnabled onTextStateChange={second}/>);
 expect(child.props.onTextStateChange).toBe(report); expect(child.props.textDraftEnabled).toBe(true);
 act(() => report({ dirty: true, busy: false })); expect(second).toHaveBeenLastCalledWith({dirty:true,busy:false});
});
it('blocks busy switches synchronously without asking and same-tab clicks discard nothing', () => {
 const discard = vi.fn(() => true); render(<VersionedEditor {...props()} modeAdapter={{beforeDiscard:discard,selection:vi.fn()} as any}/>); open(); discard.mockClear();
 act(() => child.props.onTextStateChange({dirty:true,busy:true})); standard(); open();
 expect(screen.getByText('Text child boundary')).toBeTruthy(); expect(discard).not.toHaveBeenCalled();
});
it('denies dirty discard, then clears reported state when accepted', () => {
 const confirm = vi.fn(() => false), outward = vi.fn(); vi.stubGlobal('confirm',confirm);
 render(<VersionedEditor {...props()} onTextStateChange={outward}/>); open();
 act(() => child.props.onTextStateChange({dirty:true,busy:false})); standard(); expect(screen.getByText('Text child boundary')).toBeTruthy();
 confirm.mockReturnValue(true); standard(); expect(screen.queryByText('Text child boundary')).toBeNull();
 expect(outward).toHaveBeenLastCalledWith({dirty:false,busy:false});
});
it('uses existing adapter confirmation instead of global confirm and resets on unmount', () => {
 const discard=vi.fn(()=>true), confirm=vi.fn(), outward=vi.fn(); vi.stubGlobal('confirm',confirm);
 const view=render(<VersionedEditor {...props()} modeAdapter={{beforeDiscard:discard,selection:vi.fn()} as any} onTextStateChange={outward}/>);open();
 act(()=>child.props.onTextStateChange({dirty:true,busy:false}));discard.mockReturnValue(false);standard();
 expect(screen.getByText('Text child boundary')).toBeTruthy();expect(confirm).not.toHaveBeenCalled();
 view.unmount();expect(outward).toHaveBeenLastCalledWith({dirty:false,busy:false});
});

it('publishes existing busy dirty state to a replacement observer without another child event', () => {
 const p=props(), first=vi.fn(), second=vi.fn();
 const view=render(<VersionedEditor {...p} onTextStateChange={first}/>);open();
 const report=child.props.onTextStateChange;
 act(()=>report({dirty:true,busy:true}));
 view.rerender(<VersionedEditor {...p} onTextStateChange={second}/>);
 expect(second).toHaveBeenCalledTimes(1);expect(second).toHaveBeenLastCalledWith({dirty:true,busy:true});
 expect(child.props.onTextStateChange).toBe(report);standard();expect(screen.getByText('Text child boundary')).toBeTruthy();
 view.rerender(<VersionedEditor {...p} onTextStateChange={second}/>);expect(second).toHaveBeenCalledTimes(1);
});
