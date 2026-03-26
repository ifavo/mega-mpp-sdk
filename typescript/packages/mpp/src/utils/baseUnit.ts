import { z } from "mppx";

const BASE_UNIT_INTEGER_PATTERN = /^\d+$/;

export function baseUnitIntegerString(label: string) {
  return z
    .string()
    .check(
      z.regex(
        BASE_UNIT_INTEGER_PATTERN,
        `Use a base-unit integer string for ${label} before retrying.`,
      ),
    );
}
