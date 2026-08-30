/**
 * Submits an account deletion request to Netlify Forms.
 *
 * Netlify detects forms by parsing the HTML it publishes, which never sees a
 * form rendered by React at runtime. `public/__forms.html` declares the fields
 * at build time so the form exists on Netlify's side; this posts to it.
 */

import { userError } from "./errors";

export const DELETION_FORM_NAME = "account-deletion";

export interface DeletionRequest {
  email: string;
  reason: string;
}

export async function submitDeletionRequest(
  request: DeletionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const body = new URLSearchParams({
    "form-name": DELETION_FORM_NAME,
    email: request.email,
    reason: request.reason,
    // Netlify's honeypot: a real person leaves it empty, a bot fills it in.
    company: "",
  });

  const response = await fetchImpl("/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw userError(
      "We could not send your request. Please email us, or delete your account from the app.",
    );
  }
}
