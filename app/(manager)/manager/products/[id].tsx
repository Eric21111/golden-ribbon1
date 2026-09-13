import { Redirect } from 'expo-router';

/** Edit product now opens as a modal from the Products list. */
export default function EditProductScreen() {
  return <Redirect href="/manager/products" />;
}
