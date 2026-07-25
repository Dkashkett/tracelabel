import { describe, expect, it } from "vitest";
import { optionTone, toneSelectedClasses } from "./optionTone";

describe("optionTone", () => {
  it("maps positive verdict words", () => {
    for (const opt of ["pass", "yes", "correct", "good", "accept", "approve", "true"]) {
      expect(optionTone(opt)).toBe("positive");
    }
  });

  it("maps negative verdict words", () => {
    for (const opt of ["fail", "no", "incorrect", "bad", "reject", "wrong", "false"]) {
      expect(optionTone(opt)).toBe("negative");
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(optionTone("  PASS ")).toBe("positive");
    expect(optionTone("Fail")).toBe("negative");
  });

  it("falls back to neutral for unknown options", () => {
    for (const opt of ["maybe", "escalate", "category-a", ""]) {
      expect(optionTone(opt)).toBe("neutral");
    }
  });

  it("has selected classes for every tone", () => {
    for (const tone of ["positive", "negative", "neutral"] as const) {
      expect(toneSelectedClasses[tone].button).toBeTruthy();
      expect(toneSelectedClasses[tone].kbd).toBeTruthy();
    }
  });
});
