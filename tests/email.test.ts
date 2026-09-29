import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emailConfigured,
  parseSender,
  sendEmail,
  textToHtml,
} from "../src/lib/product/email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const configure = () => {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "token_test");
  vi.stubEnv("EMAIL_FROM", "FloatAlpha <noreply@floatalpha.com>");
};

describe("email stays fail-closed", () => {
  it("requires every credential before it will send", () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(emailConfigured()).toBe(false);
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    expect(emailConfigured()).toBe(false);
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_test");
    expect(emailConfigured()).toBe(false);
    vi.stubEnv("EMAIL_FROM", "noreply@floatalpha.com");
    expect(emailConfigured()).toBe(true);
  });

  it("refuses to send when unconfigured rather than failing at the provider", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    await expect(sendEmail("a@b.test", "s", "t")).rejects.toThrow(
      "EMAIL_UNAVAILABLE",
    );
  });
});

describe("the sender is parsed from EMAIL_FROM", () => {
  it("splits a display name from the address", () => {
    expect(parseSender("FloatAlpha <noreply@floatalpha.com>")).toEqual({
      address: "noreply@floatalpha.com",
      name: "FloatAlpha",
    });
  });

  it("accepts a bare address", () => {
    expect(parseSender("noreply@floatalpha.com")).toEqual({
      address: "noreply@floatalpha.com",
    });
    expect(parseSender("  noreply@floatalpha.com  ")).toEqual({
      address: "noreply@floatalpha.com",
    });
  });
});

describe("plain text becomes usable HTML", () => {
  it("makes a bare link clickable", () => {
    // The password-reset message is text ending in a URL. Sent as raw HTML it
    // would render as unclickable text, which breaks the email's whole point.
    const html = textToHtml("Reset your password: https://floatalpha.com/r?t=1");
    expect(html).toContain(
      '<a href="https://floatalpha.com/r?t=1">https://floatalpha.com/r?t=1</a>',
    );
  });

  it("escapes markup before linking, so a message cannot inject HTML", () => {
    const html = textToHtml('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an ampersand inside a link without breaking the href", () => {
    const html = textToHtml("Go: https://floatalpha.com/a?x=1&y=2");
    // Attribute values take the escaped form; the anchor stays well formed.
    expect(html).toContain(
      '<a href="https://floatalpha.com/a?x=1&amp;y=2">https://floatalpha.com/a?x=1&amp;y=2</a>',
    );
    expect(html).not.toContain('href="https://floatalpha.com/a?x=1&y=2"');
  });

  it("keeps paragraphs and line breaks", () => {
    expect(textToHtml("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
    expect(textToHtml("one\ntwo")).toBe("<p>one<br>two</p>");
  });
});

describe("the request matches the provider contract", () => {
  it("posts Basic-authenticated JSON in the documented shape", async () => {
    configure();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ operationId: "op_1" }), { status: 201 }),
      );
    const result = await sendEmail(
      "user@example.test",
      "Verify your FloatAlpha email",
      "Verify your email address: https://floatalpha.com/v?t=1",
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://comms.twilio.com/v1/Emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from("AC_test:token_test").toString("base64")}`,
    );
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: { address: "noreply@floatalpha.com", name: "FloatAlpha" },
      to: [{ address: "user@example.test" }],
      content: { subject: "Verify your FloatAlpha email" },
    });
    expect(body.content.html).toContain("<a href=");
    expect(result).toEqual({ id: "op_1" });
  });

  it("reports a fixed code on failure, never the provider payload", async () => {
    configure();
    // An error body can echo the recipient and a reset link.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "bad recipient a@b.test" }), {
        status: 400,
      }),
    );
    await expect(sendEmail("a@b.test", "s", "t")).rejects.toThrow(
      "EMAIL_DELIVERY_FAILED",
    );
  });

  it("sends no idempotency field the API does not define", async () => {
    configure();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ operationId: "op_2" }), { status: 201 }),
      );
    await sendEmail("a@b.test", "s", "t", "alert-event-id");
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body),
    );
    // Claiming idempotency the provider does not offer would be worse than
    // not claiming it: the caller's own delivered-flag is the real guard.
    expect(JSON.stringify(body)).not.toContain("alert-event-id");
  });
});
