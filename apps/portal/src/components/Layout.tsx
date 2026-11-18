import { useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { getTenant } from "../data/api";
import { usePortal } from "./PortalProvider";

export const NAV_ITEMS = [
  { to: "/", label: "Dashboard", glyph: "dashboard", end: true },
  { to: "/bookings", label: "Bookings", glyph: "bookings" },
  { to: "/embed", label: "Booking Form", glyph: "form" },
  { to: "/services", label: "Services & Pricing", glyph: "services" },
  { to: "/settings", label: "Settings", glyph: "settings" },
] as const;

const ICONS:Record<string,string>={dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',bookings:'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M7 3v4 M17 3v4 M3 11h18 M7 15h3 M14 15h3',form:'M7 3h10l3 3v15H4V3h3 M8 9h8 M8 13h8 M8 17h5',services:'M12 3 3 8l9 5 9-5-9-5Z M3 12l9 5 9-5 M3 16l9 5 9-5',settings:'M4 7h16 M4 17h16 M8 4v6 M16 14v6'};
export function PortalIcon({name}:{name:string}){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]??ICONS.dashboard}/></svg>;}

/** Presentation only: connected mode never reads the demo tenant store. */
export function PortalShell({children,tenantName,roleLabel,mode}:{children:ReactNode;tenantName:string;roleLabel?:string;mode:"demo"|"connected"}){
 const [navOpen,setNavOpen]=useState(false),toggle=useRef<HTMLButtonElement>(null);
 const path=useLocation().pathname;
 const title=NAV_ITEMS.find(item=>item.to==='/'?path==='/':path.startsWith(item.to))?.label??'Workspace';
 return <div className="shell booking-studio">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <div className="shell-body">
   <nav id="portal-nav" className={`sidebar ${navOpen?'open':''}`} aria-label="Portal sections" onKeyDown={event=>{if(event.key==='Escape'){setNavOpen(false);toggle.current?.focus();}}}>
    <div className="sidebar-brand"><span className="sidebar-wordmark">Lumin<span className="brand-dot">.</span></span><small>Booking workspace</small></div>
    <button type="button" className="nav-close" onClick={()=>{setNavOpen(false);toggle.current?.focus();}}>Close menu <span aria-hidden="true">×</span></button>
    <p className="nav-section-label">WORKSPACE</p>
    <ul>{NAV_ITEMS.filter(item=>item.to!=='/settings').map(item=><li key={item.to}><NavLink to={item.to} end={'end'in item?item.end:false} title={item.label} className={({isActive})=>isActive?'nav-link active':'nav-link'} onClick={()=>setNavOpen(false)}><PortalIcon name={item.glyph}/><span className="nav-label">{item.label}</span></NavLink></li>)}</ul>
    <div className="sidebar-footer"><NavLink to="/settings" title="Settings" className={({isActive})=>isActive?'nav-link active':'nav-link'} onClick={()=>setNavOpen(false)}><PortalIcon name="settings"/><span className="nav-label">Settings</span></NavLink><div className="sidebar-identity"><span className="role-badge">{roleLabel??'Signed out'}</span><span className="sidebar-tenant" title={tenantName}>{tenantName}</span></div></div>
   </nav>
   <div className="workspace-frame">
    <header className="topbar"><button ref={toggle} type="button" className="nav-toggle" aria-expanded={navOpen} aria-controls="portal-nav" onClick={()=>{setNavOpen(v=>!v);if(!navOpen)requestAnimationFrame(()=>document.querySelector<HTMLAnchorElement>('#portal-nav a')?.focus());}}><svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menu</span></button><div className="workspace-heading"><span className="topbar-brand">Booking Lumin</span><span className="workspace-divider" aria-hidden="true">/</span><span>{title}</span></div><span className="workspace-mode">{mode==='demo'?'Demo':'Connected workspace'}</span></header>
    <main id="main-content" className="content" tabIndex={-1}><p className="workspace-notice" role="note"><span className="notice-dot" aria-hidden="true"/>{mode==='demo'?'Demo workspace  -  sample data stays in this app and is not synchronized.':'Connected records  -  payments and external providers remain inactive.'}</p>{children}</main>
   </div>
  </div>
 </div>;
}

export function Layout({children}:{children:ReactNode}){const {ctx,store}=usePortal();const tenant=getTenant(ctx,store);return <PortalShell tenantName={tenant.name} roleLabel={ctx.role==='BUSINESS_OWNER'?'Owner':'Staff'} mode="demo">{children}</PortalShell>;}
