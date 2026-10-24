/**
 * Drink Choice: wizard state <-> the p_drink_choices payload of create_complete_product / update_complete_product,
 * and the saved product_drink_choices rows.
 *
 * Kept free of React and path aliases so it can be unit-tested directly. It does not talk to the backend.
 *
 * A meal option can "include a drink": the cashier picks ONE of its eligible drinks per meal ordered. Per option the
 * wizard keeps { enabled, drinkIds } (drinkIds are real product ids). Only options that include a drink with at least
 * one drink are saved.
 *
 * Payload (the COMPLETE set for the product):
 *   { drink_product_id: "<products.id>",
 *     variant_id?: "<product_variants.id>"  (an option that already exists)
 *     variant_name?: "<name>"               (a new option; resolved after it is created) }
 */
import type { WizardVariantRef } from './stockUseMapping';

export type DrinkChoiceLike = { enabled: boolean; drinkIds: string[] };

export type DrinkChoicePayload = {
  drink_product_id: string;
  variant_id?: string;
  variant_name?: string;
};

/** A saved row of product_drink_choices. */
export type SavedDrinkChoice = {
  variant_id: string;
  drink_product_id: string;
};

/** Builds the complete payload. Options that do not include a drink, or have no drink selected, are left out. */
export function buildDrinkChoicePayload(
  choices: Record<string, DrinkChoiceLike>,
  variants: WizardVariantRef[],
): DrinkChoicePayload[] {
  const payload: DrinkChoicePayload[] = [];
  for (const variant of variants) {
    const choice = choices[variant.key];
    if (!choice?.enabled) continue;
    const scope = variant.id ? { variant_id: variant.id } : { variant_name: variant.name.trim() };
    for (const drinkId of [...new Set(choice.drinkIds)]) {
      payload.push({ drink_product_id: drinkId, ...scope });
    }
  }
  return payload;
}

/**
 * Turns saved rows into the wizard's state: an option with saved drinks "includes a drink" with those drinks, listed
 * A to Z by name (nameOf) so reopening always shows the same order. Rows of an option that no longer exists are left out.
 */
export function savedDrinkChoicesToState(
  rows: SavedDrinkChoice[],
  variants: WizardVariantRef[],
  nameOf: (drinkProductId: string) => string = (id) => id,
): Record<string, DrinkChoiceLike> {
  const keyByVariantId = new Map(variants.filter((variant) => variant.id).map((variant) => [variant.id as string, variant.key]));
  const state: Record<string, DrinkChoiceLike> = {};
  for (const row of rows) {
    const key = keyByVariantId.get(row.variant_id);
    if (!key) continue;
    (state[key] ??= { enabled: true, drinkIds: [] }).drinkIds.push(row.drink_product_id);
  }
  for (const choice of Object.values(state)) {
    choice.drinkIds.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));
  }
  return state;
}

/** Order-independent form of a payload, for "did the drink choices change?". */
export function canonicalDrinkChoices(payload: DrinkChoicePayload[]): string {
  return JSON.stringify(
    payload
      .map((use) => [use.variant_id ?? (use.variant_name ? `n:${use.variant_name.toLowerCase()}` : ''), use.drink_product_id] as const)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}

/**
 * What to send as p_drink_choices when saving an EDIT. undefined = leave the saved drink choices untouched (nothing
 * about them changed, so an unrelated edit can never rewrite or lose them). Otherwise the complete new set, which
 * replaces the saved one; an empty array removes them all.
 */
export function drinkChoicesForSave(baselineCanonical: string, current: DrinkChoicePayload[]): DrinkChoicePayload[] | undefined {
  return canonicalDrinkChoices(current) === baselineCanonical ? undefined : current;
}
