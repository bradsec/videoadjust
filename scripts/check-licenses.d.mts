export const ALLOWED: Set<string>;
export function isAllowed(expression: string): boolean;
export function checkLicenses(
  licenses: Record<string, Array<{ name: string; versions?: string[] }>>,
  thirdPartyText: string,
): string[];
