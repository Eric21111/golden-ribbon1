import { z } from 'zod';

export const PRICE_PATTERN = /^[0-9]{1,10}(\.[0-9]{1,2})?$/;

export const productVariantSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Variant name is required.').max(60),
  default_price: z
    .string()
    .trim()
    .refine((value) => value !== '', 'Enter a valid non-negative price.')
    .refine((value) => PRICE_PATTERN.test(value), 'Use a price with at most 10 digits and 2 decimal places.'),
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
      .refine((value) => value === '' || PRICE_PATTERN.test(value), 'Use a price with at most 10 digits and 2 decimal places.'),
    is_active: z.boolean(),
    pricingType: z.enum(['single', 'variants']),
    variants: z.array(productVariantSchema).max(50, 'Add between 1 and 50 variants.'),
  })
  .refine((data) => data.pricingType === 'single' || data.variants.length > 0, {
    message: 'Add at least one variant.',
    path: ['variants'],
  })
  .refine((data) => data.pricingType === 'single' || data.variants.some((variant) => variant.is_active), {
    message: 'At least one variant must be active.',
    path: ['variants'],
  })
  .refine(
    (data) => {
      const names = data.variants.map((variant) => variant.name.trim().toLowerCase()).filter(Boolean);
      return names.length === new Set(names).size;
    },
    { message: 'Variant names must be unique.', path: ['variants'] },
  )
  .refine(
    (data) => data.pricingType === 'variants' || data.selling_price === '' || PRICE_PATTERN.test(data.selling_price),
    { message: 'Enter a valid non-negative price.', path: ['selling_price'] },
  );

export type ProductFormValues = z.infer<typeof productSchema>;
export type ProductVariantFormValue = z.infer<typeof productVariantSchema>;
