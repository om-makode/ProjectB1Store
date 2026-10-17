import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { envResult } from '@/config/env';
import { toAppError } from '@/lib/errors';
import { layout, spacing } from '@/theme/tokens';
import { Button, Screen, ScreenHeader, Text, TextField, showToast, type TextInputRef } from '@/ui';

import { sendEmailOtp, signInWithGoogle, signInWithPassword, verifyEmailOtp } from './api';
import { isGoogleAvailable } from './google';
import type { LoginReason } from './useRequireLogin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_SECONDS = 60;
/** Password login for test accounts: development builds only, and only when enabled in .env. */
const PASSWORD_LOGIN = __DEV__ && envResult.ok && envResult.env.devPasswordLogin;
const REASONS: LoginReason[] = [
  'checkout',
  'wishlist',
  'addresses',
  'profile',
  'notify',
  'orders',
  'notifications',
  'generic',
];

export function LoginScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ reason?: string }>();
  const reason = (REASONS as string[]).includes(params.reason ?? '')
    ? (params.reason as LoginReason)
    : 'generic';

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'verify' | 'google' | 'password' | null>(null);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<TextInputRef>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const errorText = (e: unknown) => {
    const err = toAppError(e);
    if (err.code === 'AUTH_BAD_CODE') return t('auth.badCode');
    if (err.code === 'AUTH_BAD_EMAIL') return t('auth.badEmail');
    if (err.code === 'AUTH_RATE_LIMIT') return t('auth.rateLimit');
    if (err.kind === 'network') return t('errors.network');
    return t('auth.failed');
  };

  const done = () => {
    showToast(t('auth.welcome'), 'success');
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const send = async () => {
    if (!EMAIL_RE.test(email.trim())) return setError(t('auth.badEmail'));
    setError(null);
    setBusy('send');
    try {
      await sendEmailOtp(email);
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
      setTimeout(() => codeRef.current?.focus(), 300);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (!/^\d{6}$/.test(value)) return setError(t('auth.badCode'));
    setError(null);
    setBusy('verify');
    try {
      await verifyEmailOtp(email, value);
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const loginWithPassword = async () => {
    if (!EMAIL_RE.test(email.trim())) return setError(t('auth.badEmail'));
    if (!password) return setError(t('auth.failed'));
    setError(null);
    setBusy('password');
    try {
      await signInWithPassword(email, password);
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setError(null);
    setBusy('google');
    try {
      if (await signInWithGoogle()) done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen maxWidth={layout.readableMax} scroll padded={false}>
      <ScreenHeader title={t('auth.title')} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.lg }}>
        <Text variant="h2" accessibilityRole="header">
          {t(`auth.reason.${reason}`)}
        </Text>

        {step === 'email' ? (
          <>
            <TextField
              testID="login-email"
              label={t('auth.emailLabel')}
              placeholder={t('auth.emailPlaceholder')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setError(null);
              }}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={send}
              error={error}
            />
            <Button
              testID="login-send"
              title={t('auth.sendCode')}
              onPress={send}
              loading={busy === 'send'}
              disabled={!!busy}
              fullWidth
              size="lg"
            />
            {PASSWORD_LOGIN ? (
              <>
                <TextField
                  testID="login-password"
                  label={t('auth.passwordLabel')}
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setError(null);
                  }}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="password"
                  returnKeyType="go"
                  onSubmitEditing={loginWithPassword}
                />
                <Button
                  testID="login-password-submit"
                  title={t('auth.passwordLogin')}
                  variant="secondary"
                  onPress={loginWithPassword}
                  loading={busy === 'password'}
                  disabled={!!busy}
                  fullWidth
                  size="lg"
                />
              </>
            ) : null}
            {isGoogleAvailable() ? (
              <>
                <Text align="center" color="textMuted">
                  {t('auth.or')}
                </Text>
                <Button
                  title={t('auth.google')}
                  icon="google"
                  variant="secondary"
                  onPress={google}
                  loading={busy === 'google'}
                  disabled={!!busy}
                  fullWidth
                  size="lg"
                />
              </>
            ) : null}
          </>
        ) : (
          <>
            <Text color="textMuted">{t('auth.codeSentTo', { email: email.trim() })}</Text>
            <TextField
              ref={codeRef}
              testID="login-code"
              label={t('auth.codeLabel')}
              value={code}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                setError(null);
                if (digits.length === 6) void verify(digits);
              }}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              style={{ letterSpacing: 8, textAlign: 'center' }}
              error={error}
            />
            <Button
              testID="login-verify"
              title={t('auth.verify')}
              onPress={() => void verify()}
              loading={busy === 'verify'}
              disabled={!!busy}
              fullWidth
              size="lg"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Button
                variant="ghost"
                title={t('auth.changeEmail')}
                onPress={() => {
                  setStep('email');
                  setError(null);
                }}
              />
              <Button
                variant="ghost"
                title={wait > 0 ? t('auth.resendIn', { seconds: wait }) : t('auth.resend')}
                onPress={send}
                disabled={wait > 0 || !!busy}
              />
            </View>
          </>
        )}

        <Text variant="caption" color="textMuted" align="center">
          {t('auth.terms')}
        </Text>
      </View>
    </Screen>
  );
}
