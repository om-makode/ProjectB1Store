import { Redirect, useLocalSearchParams } from 'expo-router';

/** Category share links: https://<web host>/c/<slug> → category screen. */
export default function ShareCategoryRedirect() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: '/category/[slug]', params: { slug } }} />;
}
