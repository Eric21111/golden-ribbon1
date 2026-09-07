import { z } from 'zod';

export const branchSchema = z.object({
  name: z.string().trim().min(2, 'Branch name must be at least 2 characters.').max(100),
  code: z
    .string()
    .trim()
    .min(2, 'Branch code must be at least 2 characters.')
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, 'Use only letters, numbers, and hyphens.'),
  address: z.string().trim().max(300).optional(),
  is_main_branch: z.boolean(),
  is_active: z.boolean(),
});

export type BranchFormValues = z.infer<typeof branchSchema>;
