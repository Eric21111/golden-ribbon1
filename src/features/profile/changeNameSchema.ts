import { z } from 'zod';

export function changeNameSchema(currentName: string) {
  const current = currentName.trim();

  return z.object({
    full_name: z
      .string()
      .trim()
      .min(2, 'Enter a name with at least 2 characters.')
      .max(120, 'Use no more than 120 characters.'),
  }).superRefine((values, ctx) => {
    if (values.full_name === current) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'New name must be different from the current name.',
        path: ['full_name'],
      });
    }
  });
}

export type ChangeNameValues = z.infer<ReturnType<typeof changeNameSchema>>;
