import { describe, expect, it } from "vitest";
import { SECTIONS, leaksEngineTerm, levelLabels } from "./studio/shell";

describe("level labels", () => {
  it("names the ACT, not the person, in Design", () => {
    expect(levelLabels("design")).toEqual({ beginner: "Fill in", expert: "Build" });
  });

  it("names the ACT, not the person, in Production", () => {
    expect(levelLabels("production")).toEqual({ beginner: "Air", expert: "Desk" });
  });

  it("offers no switch where there is nothing to reveal", () => {
    for (const section of [
      "home",
      "templates",
      "marketplace",
      "assets",
      "outputs",
      "settings",
    ] as const) {
      expect(levelLabels(section)).toBeNull();
    }
  });

  it("never says beginner or expert to a user", () => {
    for (const spec of SECTIONS) {
      const labels = levelLabels(spec.id);
      if (labels === null) continue;
      const words = `${labels.beginner} ${labels.expert}`.toLowerCase();
      expect(words).not.toContain("beginner");
      expect(words).not.toContain("expert");
      expect(words).not.toContain("advanced");
      expect(words).not.toContain("simple");
    }
  });

  it("leaks no engine term", () => {
    for (const spec of SECTIONS) {
      const labels = levelLabels(spec.id);
      if (labels === null) continue;
      expect(leaksEngineTerm(labels.beginner)).toBeNull();
      expect(leaksEngineTerm(labels.expert)).toBeNull();
    }
  });
});
