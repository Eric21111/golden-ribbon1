import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
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

export default function LoginScreen() {
  const { signIn } = useAuth();
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

  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.brand}>
        <Text style={styles.eyebrow}>STAFF OPERATIONS</Text>
        <Text style={styles.title}>Golden Ribbon</Text>
        <Text style={styles.subtitle}>Inventory and point-of-sale foundation</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Log in</Text>
        <Text style={styles.helper}>Use the staff account created by your administrator.</Text>
        {!isSupabaseConfigured ? (
          <Text style={styles.configError}>Supabase is not configured. Copy .env.example to .env and add your project values.</Text>
        ) : null}
        <Controller control={control} name="email" render={({ field, fieldState }) => (
          <FormField label="Email" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
        )} />
        <Controller control={control} name="password" render={({ field, fieldState }) => (
          <FormField label="Password" value={field.value} onBlur={field.onBlur} onChangeText={field.onChange} error={fieldState.error?.message} autoCapitalize="none" autoComplete="current-password" secureTextEntry />
        )} />
        {formState.errors.root?.message ? <Text style={styles.error}>{formState.errors.root.message}</Text> : null}
        <AppButton disabled={!isSupabaseConfigured} label="Log in" loading={formState.isSubmitting} onPress={handleSubmit(submit)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center', padding: spacing.lg },
  brand: { gap: spacing.xs, marginBottom: spacing.md },
  eyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 34, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 15 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cardTitle: { color: colors.text, fontSize: 23, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  configError: { color: colors.danger, backgroundColor: '#FEF2F2', padding: 12, borderRadius: radius.sm, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
