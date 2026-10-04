import {BusinessProfile,type BusinessType,type ServiceArchetype} from "@lumin/contracts";
import {getTemplate} from "./registry";

export interface BusinessTemplateDefaults {
 readonly templateVersion:1;
 readonly businessType:BusinessType;
 readonly serviceTemplateKey:string;
 readonly archetype:ServiceArchetype;
 readonly primaryNavigation:readonly {readonly id:"overview"|"bookings"|"catalog"|"resources"|"design";readonly label:string}[];
 readonly catalog:{readonly singular:string;readonly plural:string;readonly optionsLabel:string};
 readonly booking:{readonly steps:readonly {readonly id:"service"|"options"|"schedule"|"customer"|"review";readonly label:string;readonly fieldIds:readonly string[]}[]};
 /** Descriptive resource defaults only. Capacity and allocation require owner configuration. */
 readonly resourceModel:{readonly kind:"crew"|"technician"|"vehicle"|"equipment";readonly mode:"pooled"|"exclusive"};
}
interface Preset {
 readonly key:string;
 readonly bookingLabel:string;
 readonly resourceLabel:string;
 readonly singular:string;
 readonly plural:string;
 readonly optionsLabel:string;
 readonly fields:readonly string[];
 readonly resource:BusinessTemplateDefaults["resourceModel"];
}
const presets:Readonly<Record<BusinessType,Preset>>={
 HOUSEKEEPING:{key:"housekeeping",bookingLabel:"Jobs",resourceLabel:"Cleaners",singular:"Service",plural:"Services",optionsLabel:"Cleaning options",fields:["answers.bedrooms","answers.bathrooms","answers.depth","answers.frequency","addonIds"],resource:{kind:"crew",mode:"pooled"}},
 AUTO_DETAILING:{key:"car-detailing",bookingLabel:"Appointments",resourceLabel:"Technicians",singular:"Detailing service",plural:"Detailing services",optionsLabel:"Detailing options",fields:["answers.package","answers.vehicle","addonIds"],resource:{kind:"technician",mode:"pooled"}},
 VEHICLE_RENTAL:{key:"vehicle-rental",bookingLabel:"Reservations",resourceLabel:"Fleet",singular:"Vehicle",plural:"Vehicles",optionsLabel:"Rental period",fields:["rentalPeriods"],resource:{kind:"vehicle",mode:"exclusive"}},
 EQUIPMENT_RENTAL:{key:"equipment-rental",bookingLabel:"Reservations",resourceLabel:"Equipment",singular:"Equipment item",plural:"Equipment",optionsLabel:"Rental period",fields:["rentalPeriods"],resource:{kind:"equipment",mode:"exclusive"}},
 EVENT_RENTAL:{key:"tent-event-rental",bookingLabel:"Reservations",resourceLabel:"Inventory",singular:"Event item",plural:"Event items",optionsLabel:"Event items and extras",fields:["itemQuantities","addonIds"],resource:{kind:"equipment",mode:"pooled"}},
 JUNK_REMOVAL:{key:"junk-removal",bookingLabel:"Pickups",resourceLabel:"Crews",singular:"Removal item",plural:"Removal items",optionsLabel:"Items and pickup extras",fields:["itemQuantities","addonIds"],resource:{kind:"crew",mode:"pooled"}},
};
function freeze<T>(value:T):T{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
/**
 * Resolve structural defaults from the authenticated business-profile receipt.
 * Parsing proves shape, not authentication: callers obtain the profile from the
 * owner API. A theme, service archetype, or label cannot substitute for it.
 * This resolver neither materializes the legacy priced service templates nor
 * persists/applies a template. Shared engines continue consuming Service data.
 */
export function getBusinessTemplateDefaults(profile:unknown):BusinessTemplateDefaults {
 const authoritative=BusinessProfile.parse(profile),p=presets[authoritative.businessType];
 return freeze({templateVersion:authoritative.templateVersion,businessType:authoritative.businessType,serviceTemplateKey:p.key,archetype:getTemplate(p.key).archetype,
  primaryNavigation:[{id:"overview",label:"Overview"},{id:"bookings",label:p.bookingLabel},{id:"catalog",label:p.plural},{id:"resources",label:p.resourceLabel},{id:"design",label:"Design"}],
  catalog:{singular:p.singular,plural:p.plural,optionsLabel:p.optionsLabel},
  booking:{steps:[{id:"service",label:p.singular,fieldIds:["serviceId"]},{id:"options",label:p.optionsLabel,fieldIds:[...p.fields]},{id:"schedule",label:"Date and time",fieldIds:["requestedStart"]},{id:"customer",label:"Contact details",fieldIds:["customer.name","customer.email"]},{id:"review",label:"Review",fieldIds:[]}]},
  resourceModel:{...p.resource}});
}
