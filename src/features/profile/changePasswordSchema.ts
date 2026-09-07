import { z } from 'zod';

export const changePasswordSchema = z.object({
  current_password: z.string().min(1, 'Current password is required.'),
  new_password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Use no more than 72 characters.'),
  confirm_password: z.string().min(1, 'Confirm the new password.'),
}).superRefine((values, ctx) => {
  if (values.new_password === values.current_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'New password must be different from the current password.',
      path: ['new_password'],
    });
  }
  if (values.new_password !== values.confirm_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Passwords do not match.',
      path: ['confirm_password'],
    });
  }
});

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
