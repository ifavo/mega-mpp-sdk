import { describe, expect, it } from "vitest";

import {
  describeSubmissionMode,
  formatSubmissionModeLabel,
} from "./submissionMode.js";

describe("submissionMode helpers", () => {
  it("formats the realtime label for the environment panel", () => {
    expect(formatSubmissionModeLabel("realtime")).toBe("Realtime");
  });

  it("describes realtime mini-block behavior for the demo UI", () => {
    expect(describeSubmissionMode("realtime")).toMatch(/mini blocks/i);
  });
});
