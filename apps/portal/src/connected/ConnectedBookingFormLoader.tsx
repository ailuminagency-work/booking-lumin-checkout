import {Component,Suspense,lazy,useState,type ComponentProps,type ComponentType,type ReactNode} from 'react';
import type {PaidSimplePublisher} from './PaidSimplePublisher';
type EditorProps=ComponentProps<typeof PaidSimplePublisher>;
export type BookingFormEditorLoader=()=>Promise<{default:ComponentType<EditorProps>}>;
const loadOwnerEditor:BookingFormEditorLoader=()=>import('./PaidSimplePublisher').then(module=>({default:module.PaidSimplePublisher}));
class BookingFormErrorBoundary extends Component<{children:ReactNode;retry:()=>void},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return{failed:true};}
 render(){return this.state.failed?<section aria-label="Booking Form loading error"><h1>Booking Form</h1><p role="alert">The Booking Form editor could not be opened. Your signed-in session and saved operation state remain in memory.</p><button type="button" onClick={this.props.retry}>Try opening Booking Form again</button><p>This retries opening the editor. It does not repeat a save or publication.</p></section>:this.props.children;}
}
/** Import only on the authenticated owner route. Retrying keeps the same client;
 * its frozen uncertain operations remain authoritative across editor remounts. */
export function ConnectedBookingFormLoader({load=loadOwnerEditor,...props}:EditorProps&{load?:BookingFormEditorLoader}){
 const [attempt,setAttempt]=useState(()=>({id:0,Editor:lazy(load)}));
 return <BookingFormErrorBoundary key={attempt.id} retry={()=>setAttempt(previous=>({id:previous.id+1,Editor:lazy(load)}))}><Suspense fallback={<section aria-label="Booking Form loading"><h1>Booking Form</h1><p role="status" aria-live="polite">Opening the Booking Form editor...</p></section>}><attempt.Editor {...props}/></Suspense></BookingFormErrorBoundary>;
}
