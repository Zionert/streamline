import { z } from 'zod';

/** A user as shown next to a comment or an activity entry (no email). */
export const userRefSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type UserRef = z.infer<typeof userRefSchema>;
