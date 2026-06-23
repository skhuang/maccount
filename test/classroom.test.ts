import { describe, it, expect } from "vitest";
import { inviteToClassroom, CLASSROOM_SCOPE } from "../src/oauth/classroom";

describe("inviteToClassroom", () => {
  it("POSTs a STUDENT invitation and returns invited", async () => {
    let captured: { url: string; body: unknown; auth: string | null } | null = null;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = {
        url: String(input),
        body: JSON.parse(String(init?.body)),
        auth: new Headers(init?.headers).get("Authorization"),
      };
      return new Response(JSON.stringify({ id: "inv1" }), { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const res = await inviteToClassroom("acc_tok", "CR-789", "stu@gmail.com", fetcher);
    expect(res).toEqual({ invited: true });
    expect(captured!.url).toBe("https://classroom.googleapis.com/v1/invitations");
    expect(captured!.auth).toBe("Bearer acc_tok");
    expect(captured!.body).toEqual({ courseId: "CR-789", userId: "stu@gmail.com", role: "STUDENT" });
  });

  it("treats 409 (already invited/member) as success", async () => {
    const fetcher = (async () => new Response("conflict", { status: 409 })) as unknown as typeof fetch;
    expect(await inviteToClassroom("t", "C", "a@b.com", fetcher)).toEqual({ already: true });
  });

  it("throws on other non-2xx, including the API body", async () => {
    const fetcher = (async () =>
      new Response('{"error":{"message":"PERMISSION_DENIED"}}', { status: 403 })) as unknown as typeof fetch;
    await expect(inviteToClassroom("t", "C", "a@b.com", fetcher)).rejects.toThrow(/403.*PERMISSION_DENIED/);
  });

  it("exports the rosters scope", () => {
    expect(CLASSROOM_SCOPE).toBe("https://www.googleapis.com/auth/classroom.rosters");
  });
});
