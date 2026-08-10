/**
 * Sign-up validation. Kept in one place so the rules the user sees on screen
 * are literally the rules that gate the submit button.
 */

// Deliberately permissive: the confirmation email is the real check. This only
// catches obvious typos before the user waits on a round trip.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export interface PasswordRule {
  id: string;
  label: string;
  met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: "length", label: "At least 8 characters", met: password.length >= 8 },
    { id: "letter", label: "A letter", met: /[a-z]/i.test(password) },
    { id: "number", label: "A number", met: /\d/.test(password) },
    {
      id: "symbol",
      label: "A symbol or capital letter",
      met: /[^a-z0-9]/.test(password) || /[A-Z]/.test(password),
    },
  ];
}

export type PasswordStrength = "weak" | "fair" | "good" | "strong";

export interface PasswordAssessment {
  rules: PasswordRule[];
  allRulesMet: boolean;
  strength: PasswordStrength;
  /** 0–100, for the meter. */
  score: number;
}

/**
 * Strength is only shown once every rule is met — before that the rules
 * themselves are the useful feedback, and two overlapping signals just add
 * noise. Beyond the rules, length and variety are what actually matter.
 */
export function assessPassword(password: string): PasswordAssessment {
  const rules = passwordRules(password);
  const allRulesMet = rules.every((rule) => rule.met);

  if (!allRulesMet) {
    const met = rules.filter((rule) => rule.met).length;
    return {
      rules,
      allRulesMet,
      strength: "weak",
      score: Math.round((met / rules.length) * 40),
    };
  }

  let score = 55;
  if (password.length >= 12) score += 15;
  if (password.length >= 16) score += 10;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 8;
  if (/[^a-zA-Z0-9]/.test(password)) score += 12;
  if (new Set(password).size >= 10) score += 10;

  // Obvious patterns undo most of the above.
  if (/(.)\1{2,}/.test(password)) score -= 15;
  if (/^(?:\d+|[a-z]+)$/i.test(password)) score -= 20;
  if (/password|qwerty|12345|letmein|admin/i.test(password)) score -= 35;

  score = Math.max(20, Math.min(100, score));

  const strength: PasswordStrength =
    score >= 85 ? "strong" : score >= 70 ? "good" : score >= 50 ? "fair" : "weak";

  return { rules, allRulesMet, strength, score };
}
