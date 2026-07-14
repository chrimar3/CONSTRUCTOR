// B0a — RULING 2026-07-14b (office-LAN + team PIN): the team-PIN format policy,
// shared by the API startup fail-secure check and the web submit gate so the two
// can never drift (operators.ts single-source precedent). Pure — no I/O, no env.
// Policy: 4-12 digits. Numeric so the phone keypad suffices (Article I); bounded
// below so a blank/trivial value can never count as a configured PIN.

const PIN_FORMAT = /^\d{4,12}$/;

/** True when the value is a well-formed team PIN: 4-12 digits, nothing else. */
export function isValidPinFormat(value: string): boolean {
  return PIN_FORMAT.test(value);
}
