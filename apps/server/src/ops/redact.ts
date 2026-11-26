/**
 * Support-bundle redaction. Applied to every log line before it leaves the PC: bearer and JWT tokens, password-like
 * key/value pairs, e-mail addresses, IBANs, and known customer / company names (passed in by the caller).
 */
const RULES: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[REDACTED-TOKEN]'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]'],
  [
    /((?:password|passwd|pwd|secret|token|refresh[_-]?token|access[_-]?token|api[_-]?key|localtoken|x-local-token|authorization|x-device-id)["']?\s*[:=]\s*["']?)([^\s"',;&}]+)/gi,
    '$1[REDACTED]',
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]'],
  [/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g, '[REDACTED-IBAN]'],
];

export function redact(text: string, names: readonly string[] = []): string {
  let out = text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 3) continue; // avoid mangling short common words
    out = out.replace(new RegExp(escapeRegExp(trimmed), 'gi'), '[REDACTED-NAME]');
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
