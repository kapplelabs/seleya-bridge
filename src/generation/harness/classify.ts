/** Turns what a harness said when it failed into one plain cause (spec 002 FR-012, research R4). */
export type FailureCode =
  "not_signed_in" | "sign_in_expired" | "usage_limit" | "permission_denied" | "crashed";

const RULES: [FailureCode, RegExp][] = [
  [
    "not_signed_in",
    /not logged in|please run \/login|login required|unauthenticated|not signed in/i,
  ],
  [
    "sign_in_expired",
    /token was revoked|token (has )?expired|log out and sign in again|sign in again|\b401\b/i,
  ],
  ["usage_limit", /rate.?limit|usage limit|quota|\b429\b|too many requests|limit reached/i],
  ["permission_denied", /permission denied|not allowed|requires approval|was blocked/i],
];

export function classifyFailure(text: string): FailureCode {
  return RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? "crashed";
}

export function failureMessage(
  code: FailureCode,
  harnessName: string,
  signInCommand?: string,
): string {
  switch (code) {
    case "not_signed_in":
      return `${harnessName} is not signed in. Run \`${signInCommand ?? harnessName}\` in a terminal to sign in, then try again.`;
    case "sign_in_expired":
      return `${harnessName} needs you to sign in again. Run \`${signInCommand ?? harnessName}\` in a terminal, then try again.`;
    case "usage_limit":
      return `${harnessName} reached its usage limit. Try again later, or pick another agent.`;
    case "permission_denied":
      return `${harnessName} was not allowed to do something it needed. Its permission checks stay on; see the activity for what it asked.`;
    case "crashed":
      return `${harnessName} stopped with an error.`;
  }
}
