import { z } from "zod";

export const Diagnostic = z.object({
  severity: z.enum(["error", "warn", "info"]),
  code: z.string(),
  message: z.string(),
  /** JSON-pointer-ish path into the roster, e.g. "/units/3". */
  path: z.string().optional(),
  fix: z.string().optional(),
});
export type Diagnostic = z.infer<typeof Diagnostic>;
