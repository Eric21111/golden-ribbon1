import { z } from 'zod';

export const employeeRoleSchema = z.enum(['manager', 'cashier']);

export const createEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required.').max(120),
  email: z.string().trim().email('Enter a valid email address.').transform((value) => value.toLowerCase()),
  password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
  confirm_password: z.string(),
  role: employeeRoleSchema,
  branch_id: z.string().uuid('Select an active branch.'),
  is_active: z.boolean(),
}).refine(v => v.password === v.confirm_password, {message:'PINs do not match.',path:['confirm_password']});

export const editEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Full name is required.').max(120),
  role: employeeRoleSchema,
  branch_id: z.string().uuid('Select an active branch.'),
  is_active: z.boolean(),
});

export const resetPasswordSchema = z.object({
  password: z.string().regex(/^[0-9]{6}$/, 'Enter exactly six digits.'),
  confirm_password: z.string().min(1, 'Confirm the temporary password.'),
}).refine((values) => values.password === values.confirm_password, {
  message: 'PINs do not match.',
  path: ['confirm_password'],
});

export type CreateEmployeeValues = z.infer<typeof createEmployeeSchema>;
export type EditEmployeeValues = z.infer<typeof editEmployeeSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
