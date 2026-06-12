/**
 * PII masking for API responses.
 *
 * OLD (weak): PAN → `ABCDE****F` (5 visible + 1 visible), Aadhaar →
 * `********1234`. Leaves enough structure for linkage attacks against
 * any leaked KYC / telecom / PAN dataset — a privacy review flagged
 * both as re-identifiable.
 *
 * NEW (current): PAN → `*********X` (only last 1 visible as a sanity
 * check for the user); Aadhaar → `************` (fully masked).
 *
 * If ops needs to search by a full PAN / Aadhaar, do it via a
 * server-side HMAC('pii-lookup', value) that never leaves the backend.
 * Display code should only ever show the masked form.
 */

function maskPan(pan: string): string {
    // PAN is 10 chars. Hide everything but the last char so users can
    // still sanity-check "this is my PAN" without the masked form
    // being linkable to their real identity.
    if (typeof pan !== "string" || pan.length < 10) return "**********";
    return pan.slice(0, 9).replace(/./g, "*") + pan.slice(9);
}

function maskAadhaar(aadhaar: string): string {
    // Aadhaar is 12 digits. UIDAI's own guidance is "only mask
    // displays, never display any digits". We follow that — displaying
    // the last 4 adds zero UX value because the user already knows
    // their own Aadhaar, and those 4 digits are highly linkable.
    if (typeof aadhaar !== "string") return "************";
    const digits = aadhaar.replace(/\D/g, "");
    if (digits.length !== 12) return "************";
    return "XXXX-XXXX-XXXX";
}

export const maskSensitiveData = (data: any) => {
    if (!data) return data;

    const shaded = { ...data };

    if (shaded.metadata) {
        if (shaded.metadata.pan_number) {
            shaded.metadata.pan_number = maskPan(shaded.metadata.pan_number);
        }

        if (shaded.metadata.aadhaar_number) {
            shaded.metadata.aadhaar_number = maskAadhaar(shaded.metadata.aadhaar_number);
        }
    }

    return shaded;
};

export { maskPan, maskAadhaar };
