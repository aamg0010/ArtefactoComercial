const emailPattern = /[\w.+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}/gi;
const personalEmailDomain = /^(?:gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|rocketmail|aol|icloud|me|mac|protonmail|proton|pm|gmx|mail|fastmail|tuta|tutanota|yandex|zoho)(?:\.|$)/i;

/** A website candidate, not proof that the domain is reachable or belongs to the company. */
export function companyWebsiteCandidate(text: string): string | null {
  const emails = [...text.matchAll(emailPattern)].map(match => match[0]);
  // Remove whole email addresses before searching, never match their domain as
  // an explicit website (an explicit site takes precedence over an email).
  const withoutEmails = text.replace(emailPattern, ' ');
  const domain = withoutEmails.match(/(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}/i)?.[0];
  const candidate = domain ?? emails.map(email => email.split('@')[1]).find(host => !personalEmailDomain.test(host));
  if (!candidate) return null;
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    return url.origin;
  } catch { return null; }
}

export function hasDirectContact(contact: { email?: string | null; phone?: string | null }) {
  return Boolean(contact.email?.trim() || contact.phone?.trim());
}

export function isVerifiedDirectContact(contact: { email?: string | null; phone?: string | null; verified?: boolean }) {
  return Boolean(contact.verified && hasDirectContact(contact));
}
