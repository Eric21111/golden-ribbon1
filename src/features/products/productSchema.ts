import { z } from 'zod';

export const productVariantSchema = z.object({
  name: z.string().trim().min(1, 'Variant name is required.').max(60),
  default_price: z
    .string()
    .trim()
    .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0), 'Enter a valid non-negative price.')
    .refine((value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value), 'Use no more than 2 decimal places.'),
  is_active: z.boolean(),
});

export const productSchema = z
  .object({
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
      .refine((value) => value === '' || (Number.isFinite(Number(value)) && Number(value) >= 0), 'Enter a valid non-negative price.')
      .refine((value) => value === '' || /^\d+(\.\d{1,2})?$/.test(value), 'Use no more than 2 decimal places.'),
    is_active: z.boolean(),
    pricingType: z.enum(['single', 'variants']),
    variants: z.array(productVariantSchema),
  })
  .refine((data) => data.pricingType === 'single' || data.variants.length > 0, {
    message: 'Add at least one variant.',
    path: ['variants'],
  })
  .refine((data) => data.pricingType === 'single' || data.variants.some((variant) => variant.is_active), {
    message: 'At least one variant must be active.',
    path: ['variants'],
  });

export type ProductFormValues = z.infer<typeof productSchema>;
export type ProductVariantFormValue = z.infer<typeof productVariantSchema>;
