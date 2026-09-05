import { ServiceTemplate } from "./types";
import { allTemplates } from "./templates";

/**
 * key → template lookup. The registry is the ONLY place the platform learns
 * a vertical's name; the engines below it stay vertical-blind.
 */
export const templateRegistry: Readonly<Record<string, ServiceTemplate>> = Object.freeze(
  Object.fromEntries(allTemplates.map((t) => [t.key, t])),
);

/** All registered templates, in catalog order (fresh array each call). */
export function listTemplates(): ServiceTemplate[] {
  return [...allTemplates];
}

/** Look up a template by key, or throw if it is not registered. */
export function getTemplate(key: string): ServiceTemplate {
  const template = templateRegistry[key];
  if (!template) throw new Error(`unknown service template: ${key}`);
  return template;
}
