import { z } from 'zod';

export const currentPinStepSchema = z.object({
  current_password: z
    .string()
    .min(1, 'Current PIN is required.')
    .regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
});

export const newPinStepSchema = z
  .object({
    current_password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
    new_password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
    confirm_password: z.string().min(1, 'Confirm PIN is required.'),
  })
  .superRefine((values, ctx) => {
    if (values.new_password === values.current_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a different PIN.',
        path: ['new_password'],
      });
    }
    if (values.new_password !== values.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PINs do not match.',
        path: ['confirm_password'],
      });
    }
  });

/** Full schema kept for callers that validate all fields together. */
export const changePasswordSchema = currentPinStepSchema
  .and(z.object({
    new_password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
    confirm_password: z.string().min(1, 'Confirm PIN is required.'),
  }))
  .superRefine((values, ctx) => {
    if (values.new_password === values.current_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose a different PIN.',
        path: ['new_password'],
      });
    }
    if (values.new_password !== values.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PINs do not match.',
        path: ['confirm_password'],
      });
    }
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
