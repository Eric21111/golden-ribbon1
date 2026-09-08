import { Redirect } from 'expo-router';

/** Create flow now opens as a modal from the Products hub. */
export default function CreateProductScreen() {
  return <Redirect href="/owner/products" />;
}
