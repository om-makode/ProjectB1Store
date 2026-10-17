import { Component, type ErrorInfo, type ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import i18n from '@/i18n';
import { captureException } from '@/lib/crash';
import { EmptyState } from '@/ui';

type State = { error: Error | null };

/**
 * Last line of defence: a render crash anywhere shows a friendly screen with "Try again"
 * instead of a blank app. Uses i18n.t directly so it works even if hooks are broken.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: info.componentStack });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState
          icon="emoticon-sad-outline"
          title={i18n.t('crash.title')}
          message={
            __DEV__
              ? `${i18n.t('crash.message')}\n\n${this.state.error.message}`
              : i18n.t('crash.message')
          }
          action={{ label: i18n.t('common.retry'), onPress: () => this.setState({ error: null }) }}
        />
      </SafeAreaView>
    );
  }
}
