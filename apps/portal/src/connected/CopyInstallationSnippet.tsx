import {useEffect,useRef,useState} from 'react';

type Props={label:string;value:string;selection:string;rows?:number};
const fieldStyle={width:'100%',maxWidth:'100%',minWidth:0} as const;

// A different receipt or business gets a new component immediately, including
// when its displayed snippet happens to be identical to the previous one.
export function CopyInstallationSnippet(props:Props){
 return <CopySelection key={JSON.stringify([props.selection,props.label,props.value])} {...props}/>;
}

function CopySelection({label,value,rows}:Props){
 const mounted=useRef(false),busy=useRef(false);
 const [phase,setPhase]=useState<'idle'|'copying'|'copied'|'unavailable'|'denied'>('idle');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const valid=value.length>0&&value.length<=8192;
 async function copy(){
  if(busy.current||!valid)return;
  busy.current=true;setPhase('copying');
  try{
   const clipboard=navigator.clipboard;
   if(!clipboard||typeof clipboard.writeText!=='function'){
    if(mounted.current)setPhase('unavailable');
   }else{
    await clipboard.writeText(value);
    if(mounted.current)setPhase('copied');
   }
  }catch{if(mounted.current)setPhase('denied');}
  finally{busy.current=false;}
 }
 return <div style={{minWidth:0}}>
  <label>{label}{rows===undefined?<input readOnly value={valid?value:''} style={fieldStyle}/>:<textarea readOnly rows={rows} value={valid?value:''} style={fieldStyle}/>}</label>
  <button type="button" disabled={!valid||phase==='copying'} onClick={()=>void copy()} aria-label={`Copy ${label}`}>{phase==='copying'?'Copying...':'Copy'}</button>
  {!valid&&<p role="status">This installation snippet is unavailable.</p>}
  {phase==='copied'&&<p role="status">Copied {label}.</p>}
  {phase==='copying'&&<p role="status">Copying {label}...</p>}
  {phase==='unavailable'&&<p role="status">Clipboard is unavailable. Select and copy {label} manually.</p>}
  {phase==='denied'&&<p role="status">Could not copy {label}. Select and copy it manually.</p>}
 </div>;
}
