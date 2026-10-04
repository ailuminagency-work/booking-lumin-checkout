import {useId,useState,type CSSProperties} from 'react';
import {formatMoney,CustomerDraftFields,type CustomerDraftTextField} from '@lumin/contracts';
import {validCustomerFieldText} from '@lumin/workflow';
import {PAID_SIMPLE_ACCENT_COLORS,type PaidSimplePresentation,type ServiceRow} from '@lumin/runtime-client';

const devices=[{label:'Mobile 320',width:320},{label:'Tablet 768',width:768},{label:'Desktop 1024',width:1024}] as const;
const controlStyle:CSSProperties={boxSizing:'border-box',width:'100%',maxWidth:'100%',minWidth:0,minHeight:44,padding:10,border:'1px solid #d1d5db',borderRadius:8,font:'inherit'};
/** Local presentation only: no runtime client, form submission, or customer capability. */
export function PaidSimpleDraftPreview({name,presentation,service,catalogLoading,customerFields}:{name:string;presentation:PaidSimplePresentation;service?:ServiceRow;catalogLoading:boolean;customerFields?:readonly CustomerDraftTextField[]}){
 const [width,setWidth]=useState<number>(320),group=useId();
 const accent=PAID_SIMPLE_ACCENT_COLORS.find(color=>color===presentation.accentColor)??'#4f46e5';
 const parsedFields=CustomerDraftFields.safeParse(customerFields??[]);
 const fields=parsedFields.success&&parsedFields.data.every(field=>validCustomerFieldText(field.label))?parsedFields.data:undefined;
 let price:string|undefined;
 if(!catalogLoading&&service?.active&&Number.isSafeInteger(service.base_price)&&service.base_price>0&&Number.isInteger(service.duration_minutes)&&service.duration_minutes>=5&&service.duration_minutes<=1440&&/^[A-Z]{3}$/.test(service.currency)){
  try{price=formatMoney({amount:service.base_price,currency:service.currency});}catch{/* Invalid catalog currency remains unverified. */}
 }
 return <section aria-label="Draft presentation preview" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
  <h3>Unpublished presentation preview</h3>
  <p>This shows current local draft edits only. It does not save or publish them, verify a published version, or start a booking. Booking controls are disabled.</p>
  <fieldset style={{minWidth:0,maxWidth:'100%',boxSizing:'border-box',margin:0}}><legend>Preview device size</legend><div style={{display:'flex',flexWrap:'wrap',gap:12}}>{devices.map(device=><label key={device.width} style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="radio" name={group} checked={width===device.width} onChange={()=>setWidth(device.width)}/>{device.label}</label>)}</div></fieldset>
  <p>Target width: {width} px. The preview shrinks to fit this owner panel; it does not simulate a separate device or verify a hosted checkout.</p>
  <div aria-label="Presentation preview frame" style={{width,maxWidth:'100%',minWidth:0,boxSizing:'border-box',border:'1px solid #d1d5db',borderRadius:16,padding:16,background:'#fff',color:'#111827',overflowWrap:'anywhere'}}>
   <h4 style={{marginTop:0,color:accent,overflowWrap:'anywhere'}}>{name.trim()||'Untitled draft'}</h4>
   {price&&service?<><p>Service: {service.name}</p><p>Current catalog price: {price}</p><p>{service.duration_minutes} minutes. Publication pins the server catalog; this preview is not a booking quote.</p></>:<p role="status">{catalogLoading?'Service details are unverified while the catalog loads.':'Service details are unavailable or unverified in the current catalog. Select a supported service to preview its title and price.'}</p>}
   <p>Staging test payments only. No real money is charged.</p>
   {fields===undefined&&<p role="alert">Fix the informational fields before previewing them. No customer form or publication was changed.</p>}
   <fieldset disabled style={{border:0,padding:0,margin:0,minWidth:0,display:'grid',gap:presentation.layout==='compact'?8:16}}><legend>Disabled booking preview</legend>
    <label style={{display:'grid',gap:6,minWidth:0}}>Your name<input style={controlStyle} autoComplete="off"/></label>
    <label style={{display:'grid',gap:6,minWidth:0}}>Email<input type="email" style={controlStyle} autoComplete="off"/></label>
    {fields?.map(field=><div key={field.id} style={{minWidth:0}}><label style={{display:'grid',gap:6,minWidth:0}}>{field.label}<input type="text" required={field.required} maxLength={field.maxLength} autoComplete="off" style={controlStyle} aria-describedby={`${group}-${field.id}`}/></label><p id={`${group}-${field.id}`} style={{margin:'6px 0 0'}}>{field.required?'Required':'Optional'} · Up to {field.maxLength} characters</p></div>)}
    <label style={{display:'grid',gap:6,minWidth:0}}>Requested date<input type="date" style={controlStyle}/></label>
    <label style={{display:'grid',gap:6,minWidth:0}}>Available time<select style={controlStyle}><option>Availability is not checked in preview</option></select></label>
    <button type="button" disabled style={{...controlStyle,background:accent,color:'#fff',whiteSpace:'normal'}}>Send unconfirmed request</button>
   </fieldset>
  </div>
 </section>;
}
