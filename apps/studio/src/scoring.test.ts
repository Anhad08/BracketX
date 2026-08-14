import { describe, expect, it } from "vitest";
import { keyForSide, scoreboardOf, sideKeyOf } from "./studio/scoring";
import type { SurfaceField } from "./studio/surface";

function field(key: string, value: unknown, label = key): SurfaceField {
  return {
    key,
    label,
    type: typeof value === "number" ? "number" : "string",
    value,
    required: false,
    overridden: false,
  } as SurfaceField;
}

const none = () => undefined;

describe("recognising a scoreboard", () => {
  it("pairs a score with the team it belongs to", () => {
    const board = scoreboardOf(
      [
        field("home", "Liverpool"),
        field("homeScore", "2", "Home score"),
        field("away", "Arsenal"),
        field("awayScore", "1", "Away score"),
        field("competition", "Premier League"),
      ],
      none,
    );

    expect(board).not.toBeNull();
    expect(board!.sides.map((s) => s.name)).toEqual(["Liverpool", "Arsenal"]);
    expect(board!.sides.map((s) => s.score)).toEqual([2, 1]);
  });

  it("claims only the score keys, so the team names stay editable", () => {
    const board = scoreboardOf(
      [field("home", "Liverpool"), field("homeScore", "2"), field("away", "Arsenal"), field("awayScore", "1")],
      none,
    );
    expect([...board!.claimed]).toEqual(["homeScore", "awayScore"]);
  });

  it("reads a score the document stores as a STRING", () => {
    // The scoreboard authors scores as strings because a text node draws them.
    // Gating on the declared type is what once found no scores at all.
    const board = scoreboardOf(
      [field("home", "A"), field("homeScore", "7"), field("away", "B"), field("awayScore", "0")],
      none,
    );
    expect(board!.sides[0]!.score).toBe(7);
  });

  it("prefers the LIVE value over the template's default", () => {
    const live = new Map<string, unknown>([["homeScore", 9]]);
    const board = scoreboardOf(
      [field("home", "A"), field("homeScore", "2"), field("away", "B"), field("awayScore", "1")],
      (key) => live.get(key),
    );
    expect(board!.sides[0]!.score).toBe(9);
  });

  it("falls back to the score's own label when no team field exists", () => {
    const board = scoreboardOf(
      [field("redScore", "3", "Red score"), field("blueScore", "2", "Blue score")],
      none,
    );
    expect(board!.sides.map((s) => s.name)).toEqual(["Red", "Blue"]);
  });

  it("is not a scoreboard with only one side", () => {
    expect(scoreboardOf([field("homeScore", "2")], none)).toBeNull();
  });

  it("is not a scoreboard when nothing is a score", () => {
    expect(
      scoreboardOf([field("name", "Alex"), field("role", "Analyst")], none),
    ).toBeNull();
  });

  it("never treats a clock as a score", () => {
    // "72'" is not a count, and a minute is not a thing you add one to.
    const board = scoreboardOf(
      [field("home", "A"), field("homeScore", "2"), field("away", "B"),
       field("awayScore", "1"), field("clock", "72'")],
      none,
    );
    expect(board!.claimed.has("clock")).toBe(false);
  });
});

describe("side keys", () => {
  it("reads the side out of the score's name", () => {
    expect(sideKeyOf("homeScore")).toBe("home");
    expect(sideKeyOf("home_score")).toBe("home");
    expect(sideKeyOf("teamAScores")).toBe("teamA");
  });

  it("declines a key that is only the word score", () => {
    expect(sideKeyOf("score")).toBeNull();
    expect(sideKeyOf("name")).toBeNull();
  });

  it("gives the left side a left-hand key", () => {
    expect(keyForSide(0)).toBe("q");
    expect(keyForSide(1)).toBe("p");
    expect(keyForSide(9)).toBeNull();
  });
});
