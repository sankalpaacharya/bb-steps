import { describe, expect, it } from "vitest";

import { formatElapsed, formatOffset } from "../lib/time";

const MINUTE = 60_000;

describe("formatElapsed", () => {
  it("reads a step's length to a tenth under a second, then whole seconds, minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(4)).toBe("<0.1s");
    expect(formatElapsed(180)).toBe("0.2s");
    expect(formatElapsed(960)).toBe("1s");
    expect(formatElapsed(8_200)).toBe("8s");
    expect(formatElapsed(41_000)).toBe("41s");
    expect(formatElapsed(59_600)).toBe("1m 00s");
    expect(formatElapsed(182_000)).toBe("3m 02s");
    expect(formatElapsed(72 * MINUTE)).toBe("1h 12m");
  });
});

describe("formatOffset", () => {
  it("reads a time into a turn as a clock", () => {
    expect(formatOffset(12_400)).toBe("0:12");
    expect(formatOffset(41 * MINUTE + 3_000)).toBe("41:03");
    expect(formatOffset(62 * MINUTE + 9_000)).toBe("1:02:09");
  });
});
