/** Turns "3AHITM" + a small running number into a join code like "3AHITM-04". */
export function makeClassCode(className: string, suffix: number): string {
  const clean = className.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${clean}-${String(suffix).padStart(2, "0")}`;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

/** The code students type for a whole class, e.g. "BMR" (a second class with the same name gets "BMR2"). */
export function makeCourseCode(className: string, attempt: number): string {
  const clean = className.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return "";
  return attempt <= 1 ? clean : `${clean}${attempt}`;
}
