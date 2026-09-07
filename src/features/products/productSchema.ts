import { z } from 'zod';

export const productSchema = z.object({
  name: z.string().trim().min(2, 'Product name must be at least 2 characters.').max(120),
  sku: z
    .string()
    .trim()
    .min(2, 'SKU must be at least 2 characters.')
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'Use only letters, numbers, and hyphens.'),
  description: z.string().trim().max(500).optional(),
  selling_price: z
    .string()
    .trim()
    .min(1, 'Selling price is required.')
    .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, 'Enter a valid non-negative price.')
    .refine((value) => /^\d+(\.\d{1,2})?$/.test(value), 'Use no more than 2 decimal places.'),
  is_active: z.boolean(),
});

export type ProductFormValues = z.infer<typeof productSchema>;
