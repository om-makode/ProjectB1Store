import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Share links are https://<web host>/p/<slug>. When the app opens one (Android App Link,
 * nearkart://p/<slug>, or the web build), go to the product screen.
 */
export default function ShareProductRedirect() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: '/product/[slug]', params: { slug } }} />;
}
