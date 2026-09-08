import { zodResolver } from '@hookform/resolvers/zod';
import { useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { z } from 'zod';

import { AppButton } from '@/components/AppButton';
import { FormField } from '@/components/FormField';
import { Screen } from '@/components/Screen';
import { colors, radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getAuthErrorMessage } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const logoSource = require('../../assets/Golden_Ribbon_Logo-removebg-preview.png');

export default function LoginScreen() {
  const { signIn } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const formMaxWidth = isTablet ? 440 : 420;
  const logoWidth = Math.min(isTablet ? 300 : width * 0.62, isTablet ? 300 : 260);
  const logoHeight = logoWidth * 0.72;
  const horizontalPad = isTablet ? spacing.xl : spacing.lg;

  const { control, handleSubmit, setError, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = async (values: LoginValues) => {
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      setError('root', { message: getAuthErrorMessage(error) });
    }
  };

  const onSubmit = handleSubmit(submit);

  return (
    <Screen
      edges={['top', 'bottom']}
      contentContainerStyle={[
        styles.screen,
        {
          padding: 0,
          paddingHorizontal: horizontalPad,
          paddingVertical: isTablet ? spacing.xl : spacing.lg,
          paddingBottom: spacing.xl + (Platform.OS === 'ios' ? 24 : 48),
        },
      ]}
    >
      <View style={[styles.column, { maxWidth: formMaxWidth }]}>
        <View style={styles.brand}>
          <Image
            accessibilityLabel="Golden Ribbons Catering"
            source={logoSource}
            resizeMode="contain"
            style={{ width: logoWidth, height: logoHeight }}
          />
          <Text style={styles.subtitle}>Staff sign-in</Text>
        </View>

        <View style={styles.card}>
          {!isSupabaseConfigured ? (
            <Text style={styles.configError}>
              Supabase is not configured. Copy .env.example to .env and add your project values.
            </Text>
          ) : null}

          <Controller
            control={control}
            name="email"
            render={({ field, fieldState }) => (
              <FormField
                label="Email"
                placeholder="name@example.com"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                keyboardType="email-address"
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            )}
          />

          <Controller
            control={control}
            name="password"
            render={({ field, fieldState }) => (
              <FormField
                ref={passwordRef}
                label="Password"
                placeholder="Enter your password"
                value={field.value}
                onBlur={field.onBlur}
                onChangeText={field.onChange}
                error={fieldState.error?.message}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="password"
                textContentType="password"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
              />
            )}
          />

          {formState.errors.root?.message ? (
            <Text style={styles.error}>{formState.errors.root.message}</Text>
          ) : null}

          <AppButton
            disabled={!isSupabaseConfigured}
            label="Log in"
            loading={formState.isSubmitting}
            onPress={() => void onSubmit()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  column: {
    width: '100%',
    gap: spacing.lg,
    alignItems: 'center',
  },
  brand: {
    alignItems: 'center',
    gap: spacing.md,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  configError: {
    color: colors.danger,
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: radius.sm,
    lineHeight: 20,
    fontSize: 14,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});
