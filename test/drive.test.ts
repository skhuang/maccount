import { describe, it, expect } from "vitest";
import {
  shareFileWithUser, asDriveRole, scopeHasFullDrive, scopeHasGroupMember, parseDriveFileId,
  DRIVE_SCOPE, GROUP_MEMBER_SCOPE, STAFF_GOOGLE_SCOPE,
} from "../src/oauth/drive";

describe("drive helpers", () => {
  it("asDriveRole normalizes to a valid role (default reader)", () => {
    expect(asDriveRole("writer")).toBe("writer");
    expect(asDriveRole("commenter")).toBe("commenter");
    expect(asDriveRole("reader")).toBe("reader");
    expect(asDriveRole("garbage")).toBe("reader");
  });

  it("scopeHasFullDrive only matches the full drive scope, not drive.file", () => {
    expect(scopeHasFullDrive(STAFF_GOOGLE_SCOPE)).toBe(true);
    expect(scopeHasFullDrive(`openid email ${DRIVE_SCOPE}`)).toBe(true);
    expect(scopeHasFullDrive("openid email https://www.googleapis.com/auth/drive.file")).toBe(false);
    expect(scopeHasFullDrive("openid email")).toBe(false);
    expect(scopeHasFullDrive(null)).toBe(false);
  });

  it("staff Google scope includes Google Group member management", () => {
    expect(STAFF_GOOGLE_SCOPE).toContain(GROUP_MEMBER_SCOPE);
    expect(scopeHasGroupMember(STAFF_GOOGLE_SCOPE)).toBe(true);
    expect(scopeHasGroupMember(`openid email ${DRIVE_SCOPE}`)).toBe(false);
  });

  it("parseDriveFileId extracts the id from common share URLs", () => {
    expect(parseDriveFileId("https://docs.google.com/document/d/ABC_123-x/edit")).toBe("ABC_123-x");
    expect(parseDriveFileId("https://drive.google.com/drive/folders/FOLDER42")).toBe("FOLDER42");
    expect(parseDriveFileId("https://drive.google.com/open?id=ID99")).toBe("ID99");
    expect(parseDriveFileId("  RAW_ID  ")).toBe("RAW_ID"); // bare id, trimmed
  });
});

describe("shareFileWithUser", () => {
  it("POSTs a user permission and returns its id", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ id: "perm1" }), { headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const id = await shareFileWithUser("acc_tok", "FILE1", "stu@gmail.com", "reader", { notify: false }, fetcher);
    expect(id).toBe("perm1");
    expect(captured!.url).toContain("/drive/v3/files/FILE1/permissions");
    expect(captured!.url).toContain("sendNotificationEmail=false");
    expect(captured!.url).toContain("supportsAllDrives=true");
    expect(captured!.body).toEqual({ role: "reader", type: "user", emailAddress: "stu@gmail.com" });
  });

  it("throws on a non-2xx response", async () => {
    const fetcher = (async () => new Response("no", { status: 403 })) as unknown as typeof fetch;
    await expect(shareFileWithUser("t", "F", "a@b.com", "reader", {}, fetcher)).rejects.toThrow(/403/);
  });
});
