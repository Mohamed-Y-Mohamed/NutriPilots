import { describe, expect, it } from "vitest";
import { assessPassword, isValidEmail } from "./validation";

describe("isValidEmail", () => {
  it.each([
    "alex@example.com",
    "alex.smith+diary@sub.example.co.uk",
    "  spaced@example.com  ",
  ])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each(["", "alex", "alex@", "@example.com", "alex@example", "alex @example.com"])(
    "rejects %s",
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );
});

describe("assessPassword", () => {
  it("reports every unmet rule so the user knows what is missing", () => {
    const { rules, allRulesMet } = assessPassword("abc");
    expect(allRulesMet).toBe(false);
    expect(rules.find((rule) => rule.id === "length")?.met).toBe(false);
    expect(rules.find((rule) => rule.id === "letter")?.met).toBe(true);
    expect(rules.find((rule) => rule.id === "number")?.met).toBe(false);
  });

  it("marks all rules met once the password qualifies", () => {
    expect(assessPassword("Broccoli9").allRulesMet).toBe(true);
  });

  it("scores a long varied password as strong", () => {
    expect(assessPassword("Kale&Quinoa42Bowl!").strength).toBe("strong");
  });

  it("penalises a password that only just scrapes the rules", () => {
    const { strength } = assessPassword("Abcdefg1");
    expect(["fair", "good"]).toContain(strength);
  });

  it("punishes well-known passwords even when they pass the rules", () => {
    const known = assessPassword("Password123!");
    const comparable = assessPassword("Rhubarb471!");
    expect(known.score).toBeLessThan(comparable.score);
  });

  it("never reports strength above weak while a rule is unmet", () => {
    expect(assessPassword("aaaaaaaaaaaaaaaaaaaa").strength).toBe("weak");
  });
});
