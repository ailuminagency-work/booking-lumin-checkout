import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useEffect,useState} from 'react';
import {BOOKING_FORM_AREAS,ConnectedBookingFormWorkspace} from './ConnectedBookingFormWorkspace';
afterEach(cleanup);
function props(client:unknown={},tenantId='first') {return {client,tenantId,panels:Object.fromEntries(BOOKING_FORM_AREAS.map(area=>[area,<p key={area}>{area} content</p>])) as Record<typeof BOOKING_FORM_AREAS[number],React.ReactNode>,status:(select:(area:typeof BOOKING_FORM_AREAS[number])=>void)=><button onClick={()=>select('Publish')}>View recovery</button>};}
it('uses manual keyboard activation with relationships and wrapping focus',()=>{
 render(<ConnectedBookingFormWorkspace {...props()}/>);const tabs=screen.getAllByRole('tab');expect(tabs).toHaveLength(5);expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby',tabs[0]!.id);
 tabs[0]!.focus();fireEvent.keyDown(tabs[0]!,{key:'ArrowRight'});expect(tabs[1]).toHaveFocus();expect(tabs[0]).toHaveAttribute('aria-selected','true');expect(tabs[1]).toHaveAttribute('aria-selected','false');
 fireEvent.keyDown(tabs[1]!,{key:'Enter'});expect(tabs[1]).toHaveAttribute('aria-selected','true');expect(screen.getByRole('tabpanel')).toHaveAttribute('id',tabs[1]!.getAttribute('aria-controls'));
 fireEvent.keyDown(tabs[1]!,{key:'End'});expect(tabs[4]).toHaveFocus();fireEvent.keyDown(tabs[4]!,{key:'ArrowRight'});expect(tabs[0]).toHaveFocus();fireEvent.keyDown(tabs[0]!,{key:'ArrowLeft'});expect(tabs[4]).toHaveFocus();fireEvent.keyDown(tabs[4]!,{key:'Home'});expect(tabs[0]).toHaveFocus();fireEvent.keyDown(tabs[0]!,{key:' '});expect(tabs[0]).toHaveAttribute('aria-selected','true');expect(tabs.filter(tab=>tab.tabIndex===0)).toHaveLength(1);
});
it('keeps hidden panels mounted and their local fields while switching or navigating recovery',()=>{
 const mounted=vi.fn();function Fields(){const [value,setValue]=useState('');useEffect(()=>{mounted();},[]);return <label>Local field<input value={value} onChange={event=>setValue(event.target.value)}/></label>;}
 const input=props();input.panels.Build=<Fields/>;render(<ConnectedBookingFormWorkspace {...input}/>);fireEvent.change(screen.getByLabelText('Local field'),{target:{value:'Retained edit'}});fireEvent.click(screen.getByRole('tab',{name:'Preview'}));expect(screen.getAllByRole('tabpanel',{hidden:true})).toHaveLength(5);expect(screen.getByLabelText('Local field')).toHaveValue('Retained edit');fireEvent.click(screen.getByRole('button',{name:'View recovery'}));expect(screen.getByRole('tab',{name:'Publish'})).toHaveAttribute('aria-selected','true');fireEvent.click(screen.getByRole('tab',{name:'Build'}));expect(screen.getByLabelText('Local field')).toHaveValue('Retained edit');expect(mounted).toHaveBeenCalledTimes(1);
});
it('resets view on tenant or client changes and constrains wrapping controls to the owner container',()=>{
 const first=props();const {rerender}=render(<div style={{width:320}}><ConnectedBookingFormWorkspace {...first}/></div>);fireEvent.click(screen.getByRole('tab',{name:'Install & Health'}));rerender(<div style={{width:320}}><ConnectedBookingFormWorkspace {...props(first.client,'second')}/></div>);expect(screen.getByRole('tab',{name:'Build'})).toHaveAttribute('aria-selected','true');fireEvent.click(screen.getByRole('tab',{name:'Design'}));rerender(<ConnectedBookingFormWorkspace {...props({},'second')}/>);expect(screen.getByRole('tab',{name:'Build'})).toHaveAttribute('aria-selected','true');expect(screen.getByRole('tablist')).toHaveStyle({flexWrap:'wrap',maxWidth:'100%',minWidth:'0'});expect(screen.getByRole('tab',{name:'Install & Health'})).toHaveStyle({maxWidth:'100%',whiteSpace:'normal'});
});
