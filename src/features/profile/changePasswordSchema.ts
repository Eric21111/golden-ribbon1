import { z } from 'zod';

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required.'),
  new_password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
  confirm_password: z.string().min(1, 'Confirm the new password.'),
}).superRefine((values, ctx) => {
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
