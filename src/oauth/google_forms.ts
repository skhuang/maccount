// Google Forms API — create a new form on behalf of the logged-in staff member
// (their connected Google account; the full `drive` scope that the Drive-share
// feature already grants authorizes forms.create, as does forms.body). The
// project must have the Google Forms API enabled. `forms.create` accepts only
// info.title/documentTitle; questions are added later by editing in Google.
export async function createGoogleForm(
  accessToken: string,
  title: string,
  fetcher: typeof fetch = fetch,
): Promise<{ formId: string; responderUri: string }> {
  const res = await fetcher("https://forms.googleapis.com/v1/forms", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ info: { title, documentTitle: title } }),
  });
  if (!res.ok) {
    // Include the API's error body — it says exactly why (e.g. "Forms API has
    // not been used in project N…" = not enabled; PERMISSION_DENIED = scope).
    const detail = await res.text().catch(() => "");
    throw new Error(`forms create failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { formId?: string; responderUri?: string };
  // responderUri is the link students fill; formId yields the edit link.
  if (!data.formId || !data.responderUri) {
    throw new Error("forms create: missing formId/responderUri");
  }
  return { formId: data.formId, responderUri: data.responderUri };
}
