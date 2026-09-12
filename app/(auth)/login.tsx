import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@react-native-vector-icons/ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/FormField';
import { radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getAuthErrorMessage } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const logoSource = require('../../assets/Golden_Ribbon_Logo-removebg-preview.png');

const NAVY = '#0A1224';
const ROYAL_BLUE = '#1E3A8A';
const ROYAL_BLUE_LIGHT = '#2E4FB8';
const GOLD = '#D4AF37';
const GOLD_MUTED = '#B7902B';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const passwordRef = useRef<TextInput>(null);
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const formMaxWidth = isTablet ? 440 : 420;
  const logoWidth = Math.min(isTablet ? 260 : width * 0.5, isTablet ? 260 : 220);
  const logoHeight = logoWidth * 0.72;
  const horizontalPad = isTablet ? spacing.xl : spacing.lg;
  const [showPassword, setShowPassword] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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
  const isDisabled = !isSupabaseConfigured || formState.isSubmitting;

  return (
    <LinearGradient
      colors={[NAVY, ROYAL_BLUE, ROYAL_BLUE_LIGHT]}
      locations={[0, 0.6, 1]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.gradient}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            contentContainerStyle={[
              styles.content,
              {
                paddingHorizontal: horizontalPad,
                paddingTop: isTablet ? spacing.xl : spacing.lg,
                paddingBottom: isKeyboardVisible ? spacing.xl * 2 : isTablet ? spacing.xl : spacing.lg,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.column, { maxWidth: formMaxWidth }]}>
              <View style={styles.brand}>
                <Image
                  accessibilityLabel="Golden Ribbons Catering"
                  source={logoSource}
                  resizeMode="contain"
                  style={{ width: logoWidth, height: logoHeight }}
                />
                <View style={styles.subtitleRow}>
                  <View style={styles.subtitleRule} />
                  <Text style={styles.subtitle}>SIGN IN</Text>
                  <View style={styles.subtitleRule} />
                </View>
              </View>

              <View style={styles.cardShadow}>
                <BlurView intensity={20} tint="light" style={styles.cardBlur}>
                  <LinearGradient
                    colors={[GOLD, GOLD_MUTED]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.cardAccent}
                  />
                  <View style={styles.cardOverlay}>
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
                          leftIcon="mail-outline"
                          iconSize={16}
                          accentColor={GOLD_MUTED}
                          labelStyle={styles.fieldLabel}
                          errorStyle={styles.fieldError}
                          style={styles.fieldInput}
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
                          leftIcon="lock-closed-outline"
                          rightIcon={showPassword ? 'eye-outline' : 'eye-off-outline'}
                          iconSize={16}
                          onRightIconPress={() => setShowPassword((prev) => !prev)}
                          rightIconAccessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                          accentColor={GOLD_MUTED}
                          labelStyle={styles.fieldLabel}
                          errorStyle={styles.fieldError}
                          style={styles.fieldInput}
                          autoCapitalize="none"
                          autoCorrect={false}
                          autoComplete="password"
                          textContentType="password"
                          secureTextEntry={!showPassword}
                          returnKeyType="go"
                          onSubmitEditing={() => void onSubmit()}
                        />
                      )}
                    />

                    {formState.errors.root?.message ? (
                      <Text style={styles.error}>{formState.errors.root.message}</Text>
                    ) : null}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isDisabled, busy: formState.isSubmitting }}
                      disabled={isDisabled}
                      onPress={() => void onSubmit()}
                      style={({ pressed }) => [
                        styles.buttonShadow,
                        pressed && !isDisabled && styles.buttonPressed,
                        isDisabled && styles.buttonDisabled,
                      ]}
                    >
                      <LinearGradient
                        colors={[NAVY, ROYAL_BLUE]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.button}
                      >
                        {formState.isSubmitting ? (
                          <ActivityIndicator color="#FFFFFF" />
                        ) : (
                          <>
                            <Text style={styles.buttonLabel}>Log in</Text>
                            <Ionicons name="arrow-forward" size={16} color={GOLD} />
                          </>
                        )}
                      </LinearGradient>
                    </Pressable>
                  </View>
                </BlurView>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center' },
  column: { width: '100%', gap: spacing.md, alignItems: 'center' },
  brand: { alignItems: 'center', gap: spacing.sm },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  subtitleRule: { width: 22, height: 1, backgroundColor: GOLD },
  subtitle: {
    color: '#E7ECFA',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2.5,
  },
  cardShadow: {
    width: '100%',
    borderRadius: radius.lg + 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 26,
    elevation: 12,
  },
  cardBlur: {
    borderRadius: radius.lg + 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.7)',
  },
  cardAccent: {
    height: 4,
    width: '100%',
  },
  cardOverlay: {
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    padding: spacing.lg,
    gap: spacing.md,
  },
  fieldLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#1C2333',
  },
  fieldInput: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    backgroundColor: '#F4F6FB',
    borderColor: '#D8DEEA',
  },
  fieldError: {
    fontFamily: 'Inter_500Medium',
  },
  configError: {
    color: '#B91C1C',
    backgroundColor: '#FEF2F2',
    padding: 12,
    borderRadius: radius.sm,
    lineHeight: 20,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  error: {
    color: '#B91C1C',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_500Medium',
  },
  buttonShadow: {
    borderRadius: radius.md,
    shadowColor: ROYAL_BLUE,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.55 },
});
