import { z } from 'zod';

export function changeEmailSchema(currentEmail: string) {
  const current = currentEmail.trim().toLowerCase();

  return z.object({
    current_password: z.string().min(1, 'Current password is required.'),
    new_email: z.string().trim().email('Enter a valid email address.'),
    confirm_email: z.string().trim().min(1, 'Confirm the new email.'),
  }).superRefine((values, ctx) => {
    if (values.new_email.toLowerCase() === current) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'New email must be different from the current email.',
        path: ['new_email'],
      });
    }
    if (values.new_email.toLowerCase() !== values.confirm_email.toLowerCase()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Emails do not match.',
        path: ['confirm_email'],
      });
    }
  });
}

export type ChangeEmailValues = z.infer<ReturnType<typeof changeEmailSchema>>;
