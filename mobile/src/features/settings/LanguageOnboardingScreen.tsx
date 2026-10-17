import { useTranslation } from 'react-i18next';

import { useSettings } from '@/stores/settings';
import { Button, Screen, Text } from '@/ui';

import { LanguagePicker } from './LanguagePicker';
import { layout } from '@/theme/tokens';

/** First launch: pick a language (default comes from the phone's locale). */
export function LanguageOnboardingScreen() {
  const { t } = useTranslation();
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const complete = useSettings((s) => s.completeLanguageOnboarding);

  return (
    <Screen maxWidth={layout.readableMax} scroll>
      <Text variant="h1" accessibilityRole="header" style={{ marginTop: 32 }}>
        {t('onboarding.chooseLanguage')}
      </Text>
      <LanguagePicker value={language} onChange={setLanguage} />
      <Text color="textMuted">{t('onboarding.changeLater')}</Text>
      <Button title={t('common.continue')} size="lg" fullWidth onPress={complete} />
    </Screen>
  );
}
