export const ALLOWED: Set<string>;
export const LGPL_WASM_EXCEPTIONS: Set<string>;
export function isAllowed(expression: string, pkgName?: string): boolean;
export function checkLicenses(
  licenses: Record<string, Array<{ name: string; versions?: string[] }>>,
  thirdPartyText: string,
): string[];
