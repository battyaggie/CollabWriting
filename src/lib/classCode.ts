/** Turns "3AHITM" + a small running number into a join code like "3AHITM-04". */
export function makeClassCode(className: string, suffix: number): string {
  const clean = className.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${clean}-${String(suffix).padStart(2, "0")}`;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
