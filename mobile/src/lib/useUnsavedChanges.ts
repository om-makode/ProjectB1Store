import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from 'expo-router';

import { confirmAction } from './confirm';

/**
 * Prompts the user before navigating away if there are unsaved changes.
 * Handles:
 * 1. React Navigation stack removals (`beforeRemove` - pops, gestures)
 * 2. Android hardware back button (`BackHandler`)
 * 3. Returns `promptDiscard()` for UI navigation triggers (e.g. header back arrow, tabs)
 */
export function useUnsavedChanges(isDirty: boolean) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const promptDiscard = useCallback(async (): Promise<boolean> => {
    if (!isDirtyRef.current) return true;
    return await confirmAction(
      t('common.unsavedChangesTitle'),
      t('common.unsavedChangesBody'),
      t('common.discard'),
      t('common.keepEditing'),
    );
  }, [t]);

  // React Navigation beforeRemove listener (gestures, programmatic pop/back)
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return;

    const unsubscribe = (navigation as any).addListener('beforeRemove', (e: any) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();

      void promptDiscard().then((discard) => {
        if (discard) {
          isDirtyRef.current = false;
          navigation.dispatch(e.data.action);
        }
      });
    });

    return unsubscribe;
  }, [navigation, promptDiscard]);

  // Android hardware back button handler
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isDirtyRef.current) return false;

      void promptDiscard().then((discard) => {
        if (discard) {
          isDirtyRef.current = false;
          if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
            navigation.goBack();
          }
        }
      });
      return true;
    });

    return () => sub.remove();
  }, [navigation, promptDiscard]);

  return { promptDiscard };
}
