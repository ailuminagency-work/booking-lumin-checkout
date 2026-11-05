import {useEffect,useState,type ComponentProps,type ComponentType} from 'react';
import type {PaidSimplePublisher} from './PaidSimplePublisher';
type EditorProps=ComponentProps<typeof PaidSimplePublisher>;
export type BookingFormEditorLoader=()=>Promise<{default:ComponentType<EditorProps>}>;
const loadOwnerEditor:BookingFormEditorLoader=()=>import('./PaidSimplePublisher').then(module=>({default:module.PaidSimplePublisher}));
type LoadState={status:'loading'}|{status:'error'}|{status:'ready';Editor:ComponentType<EditorProps>};
function BookingFormLoading(){return <section aria-label="Booking Form loading"><h1>Booking Form</h1><p role="status" aria-live="polite">Opening the Booking Form editor...</p></section>;}
function BookingFormLoadError({retry}:{retry:()=>void}){return <section aria-label="Booking Form loading error"><h1>Booking Form</h1><p role="alert">The Booking Form editor could not be opened. Your signed-in session and saved operation state remain in memory.</p><button type="button" onClick={retry}>Try opening Booking Form again</button><p>This retries opening the editor. It does not repeat a save or publication.</p></section>;}
/** Import only on the authenticated owner route. Retrying keeps the same client;
 * its frozen uncertain operations remain authoritative across editor remounts. */
export function ConnectedBookingFormLoader({load=loadOwnerEditor,...props}:EditorProps&{load?:BookingFormEditorLoader}){
 const [attempt,setAttempt]=useState(0);
 const [state,setState]=useState<LoadState>({status:'loading'});
 useEffect(()=>{let active=true;setState({status:'loading'});void load().then(module=>{if(active)setState({status:'ready',Editor:module.default});},()=>{if(active)setState({status:'error'});});return()=>{active=false;};},[load,attempt]);
 if(state.status==='error')return <BookingFormLoadError retry={()=>setAttempt(value=>value+1)}/>;
 if(state.status==='ready')return <state.Editor {...props}/>;
 return <BookingFormLoading/>;
}
