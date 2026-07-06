/**
 * Minimal E.164 handling for the India-first v1. Accepts a 10-digit local
 * number or a full +<countrycode> number and normalizes to E.164.
 */
export function normalizePhoneNumber(input: string): string | null {
  const trimmed = input.trim().replace(/[\s-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{10}$/.test(trimmed)) {
    return `+91${trimmed}`;
  }
  return null;
}
