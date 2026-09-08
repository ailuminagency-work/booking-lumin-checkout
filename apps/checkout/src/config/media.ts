/**
 * Which services collect a customer photo at checkout. Tenant-configurable and
 * vertical-neutral — a service opts in by id, the checkout renders a mock upload
 * (via @lumin/media). No vertical is hardcoded in the components.
 */
import { tentRentalService } from "./demoTenant";

const PHOTO_SERVICE_IDS: ReadonlySet<string> = new Set([tentRentalService.id]);

/** True when this service asks the customer to attach a photo of the site. */
export function serviceWantsPhoto(serviceId: string | undefined | null): boolean {
  return serviceId ? PHOTO_SERVICE_IDS.has(serviceId) : false;
}
