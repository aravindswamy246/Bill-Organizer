import { normalizePhoneNumber } from './phone';

describe('normalizePhoneNumber', () => {
  it('normalizes a bare 10-digit Indian number to E.164 with +91', () => {
    expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
  });

  it('passes through an already-E.164 number unchanged', () => {
    expect(normalizePhoneNumber('+919876543210')).toBe('+919876543210');
  });

  it('accepts a non-Indian E.164 number unchanged (identity key is not India-only)', () => {
    expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671');
  });

  it('strips spaces and hyphens before validating', () => {
    expect(normalizePhoneNumber('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhoneNumber('98765 43210')).toBe('+919876543210');
  });

  it('rejects a number with too few digits', () => {
    expect(normalizePhoneNumber('987654321')).toBeNull();
  });

  it('rejects a number with letters', () => {
    expect(normalizePhoneNumber('98765abcde')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(normalizePhoneNumber('')).toBeNull();
  });

  it('rejects a +0 country code (leading digit after + must be 1-9)', () => {
    expect(normalizePhoneNumber('+0123456789')).toBeNull();
  });
});
