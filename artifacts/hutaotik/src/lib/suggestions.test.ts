import { describe, expect, it } from "vitest";
import {
  formatArchiveCountdown,
  formatRelativeTime,
  getSuggestionStatusLabel,
} from "./suggestions";

describe("suggestions helpers", () => {
  it("maps every suggestion status to a readable label", () => {
    expect(getSuggestionStatusLabel("reviewing")).toBe("Reviewing");
    expect(getSuggestionStatusLabel("approved")).toBe("Approved");
    expect(getSuggestionStatusLabel("rejected")).toBe("Rejected");
    expect(getSuggestionStatusLabel("archived")).toBe("Archived");
  });

  it("formats 3-day auto-archive countdown accurately", () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    const twoDaysSixHoursLater = new Date(now + (54 * 60 * 60 * 1000)).toISOString();
    const fiveHoursLater = new Date(now + (5 * 60 * 60 * 1000)).toISOString();
    const past = new Date(now - 60_000).toISOString();

    expect(formatArchiveCountdown(twoDaysSixHoursLater, now)).toBe("Archives in 2d 6h");
    expect(formatArchiveCountdown(fiveHoursLater, now)).toBe("Archives in 5h");
    expect(formatArchiveCountdown(past, now)).toBe("Archiving soon");
    expect(formatArchiveCountdown(null, now)).toBeNull();
  });

  it("formats relative timestamps cleanly", () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0);
    expect(formatRelativeTime(new Date(now - 20_000).toISOString(), now)).toBe("Just now");
    expect(formatRelativeTime(new Date(now - 15 * 60_000).toISOString(), now)).toBe("15m ago");
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h ago");
    expect(formatRelativeTime(new Date(now - 2 * 86400_000).toISOString(), now)).toBe("2d ago");
  });
});
