import { PinField } from '@/components/PinField';
import { zodResolver } from '@hookform/resolvers/zod';
import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';

import { FormField } from '@/components/FormField';
import { managerGradients } from '@/components/dashboard/theme';
import { radius, spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { getAuthErrorMessage } from '@/lib/errors';
import { isSupabaseConfigured } from '@/lib/supabase';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .email('Enter a valid email address.'),
  password: z.string().min(1, 'PIN is required.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const logoSource = require('../../assets/Golden_Ribbons_Logo-removebg-preview.png');

const NAVY = '#0A1224';
const ROYAL_BLUE = '#1E3A8A';
const ROYAL_DEEP = '#163177';
const GOLD = '#D4AF37';
const FORM_MAX_WIDTH = 400;

/** Thin gold corner arcs + faint washes — clipped, never affect layout. */
function LoginBackdrop({ width, height }: { width: number; height: number }) {
  const topArc = Math.max(width, height) * 0.55;
  const bottomArc = Math.max(width, height) * 0.58;
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <View
        style={[
          styles.curveStroke,
          {
            width: topArc,
            height: topArc,
            top: -topArc * 0.55,
            left: -topArc * 0.52,
            borderRadius: topArc / 2,
          },
        ]}
      />
      <View
        style={[
          styles.curveStrokeInner,
          {
            width: topArc * 0.86,
            height: topArc * 0.86,
            top: -topArc * 0.42,
            left: -topArc * 0.4,
            borderRadius: (topArc * 0.86) / 2,
          },
        ]}
      />
      <View
        style={[
          styles.curveStroke,
          {
            width: bottomArc,
            height: bottomArc,
            bottom: -bottomArc * 0.56,
            right: -bottomArc * 0.54,
            borderRadius: bottomArc / 2,
          },
        ]}
      />
      <View
        style={[
          styles.curveStrokeInner,
          {
            width: bottomArc * 0.86,
            height: bottomArc * 0.86,
            bottom: -bottomArc * 0.44,
            right: -bottomArc * 0.42,
            borderRadius: (bottomArc * 0.86) / 2,
          },
        ]}
      />
    </View>
  );
}

export default function LoginScreen() {
  const { signIn } = useAuth();

  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isCompact = height < 700;
  const horizontalPad = isTablet ? spacing.xl : spacing.lg;
  const logoWidth = Math.min(isTablet ? 260 : width * 0.48, isTablet ? 260 : 210);
  const logoHeight = logoWidth * 0.72;
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const aboveCenterBias = isKeyboardVisible ? 0 : Math.min(height * 0.04, isCompact ? 20 : 32);

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

  const { control, handleSubmit, setError, clearErrors, formState } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = async (values: LoginValues) => {
    if (!legacyLogin && !/^[0-9]{6}$/.test(values.password)) {
      setError('password', { message: 'Enter all six digits.' });
      return;
    }
    try {
      await signIn(values.email, values.password);
    } catch (error) {
      setError('root', { message: getAuthErrorMessage(error) });
    }
  };

  const onSubmit = handleSubmit(submit);
  const isDisabled = !isSupabaseConfigured || formState.isSubmitting;

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[NAVY, '#122047', ROYAL_BLUE, ROYAL_DEEP]}
        locations={[0, 0.35, 0.72, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.gradient}
      >
        <StatusBar style="light" />
        <LoginBackdrop width={width} height={height} />
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
          >
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.content,
                {
                  paddingHorizontal: horizontalPad,
                  paddingTop: isKeyboardVisible ? spacing.sm : spacing.md,
                  paddingBottom: isKeyboardVisible ? spacing.md : spacing.lg + aboveCenterBias,
                  justifyContent: isKeyboardVisible ? 'flex-start' : 'center',
                },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              bounces={false}
            >
              <View style={[styles.column, isKeyboardVisible && styles.columnCompact]}>
                <View style={[styles.brand, isKeyboardVisible && styles.brandCompact]}>
                  <Image
                    accessibilityLabel="Golden Ribbons Catering"
                    source={logoSource}
                    resizeMode="contain"
                    style={{
                      width: isKeyboardVisible ? logoWidth * 0.82 : logoWidth,
                      height: isKeyboardVisible ? logoHeight * 0.82 : logoHeight,
                    }}
                  />
                  <View style={styles.subtitleRow}>
                    <View style={styles.subtitleRule} />
                    <Text style={styles.subtitle}>SIGN IN</Text>
                    <View style={styles.subtitleRule} />
                  </View>
                </View>

                {!isSupabaseConfigured ? (
                  <Text style={styles.configError}>
                    Supabase is not configured. Copy .env.example to .env and add your project values.
                  </Text>
                ) : null}

                <View style={styles.form}>
                  <Controller
                    control={control}
                    name="email"
                    render={({ field, fieldState }) => (
                      <FormField
                        label="Email"
                        required
                        appearance="dark"
                        placeholder="name@example.com"
                        value={field.value}
                        onBlur={field.onBlur}
                        onChangeText={(next) => {
                          field.onChange(next);
                          if (formState.errors.root) clearErrors();
                        }}
                        error={fieldState.error?.message}
                        leftIcon="mail-outline"
                        iconSize={18}
                        accentColor={GOLD}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="username"
                        textContentType="username"
                        keyboardType="email-address"
                        returnKeyType="next"
                        importantForAutofill="yes"
                      />
                    )}
                  />

                  <Controller
                    control={control}
                    name="password"
                    render={({ field, fieldState }) => (
                      <PinField
                        label={legacyLogin ? 'Password' : 'PIN'}
                        required
                        appearance="dark"
                        value={field.value}
                        onChangeText={(next) => {
                          field.onChange(next);
                          if (fieldState.error || formState.errors.root) clearErrors();
                        }}
                        error={fieldState.error?.message}
                        allowPassword
                        onLegacyChange={(legacy) => {
                          setLegacyLogin(legacy);
                          clearErrors();
                        }}
                        accentColor={GOLD}
                      />
                    )}
                  />

                  {formState.errors.root?.message ? (
                    <Text style={styles.error} accessibilityRole="alert">
                      {formState.errors.root.message}
                    </Text>
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
                      colors={[...managerGradients.hero]}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.button}
                    >
                      {formState.isSubmitting ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <View style={styles.buttonContent}>
                          <Text style={styles.buttonLabel}>Log in</Text>
                          <Ionicons name="arrow-forward" size={16} color={GOLD} />
                        </View>
                      )}
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: NAVY,
    overflow: 'hidden',
  },
  gradient: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
    backgroundColor: NAVY,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    backgroundColor: 'transparent',
  },
  flex: {
    flex: 1,
    width: '100%',
  },
  scroll: {
    flex: 1,
    width: '100%',
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: '100%',
    alignItems: 'center',
  },
  column: {
    width: '100%',
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: 'center',
    gap: spacing.lg,
    alignItems: 'stretch',
  },
  columnCompact: { gap: spacing.md },
  brand: {
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
  },
  brandCompact: { gap: spacing.sm },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subtitleRule: { width: 26, height: 1.5, backgroundColor: GOLD, borderRadius: 1 },
  subtitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 3,
  },
  form: {
    width: '100%',
    maxWidth: '100%',
    gap: spacing.md,
    alignSelf: 'stretch',
  },
  curveStroke: {
    position: 'absolute',
    borderWidth: 1.25,
    borderColor: 'rgba(212, 175, 55, 0.48)',
    backgroundColor: 'transparent',
  },
  curveStrokeInner: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.22)',
    backgroundColor: 'transparent',
  },
  configError: {
    color: '#FECACA',
    backgroundColor: 'rgba(127, 29, 29, 0.45)',
    padding: 12,
    borderRadius: radius.sm,
    lineHeight: 20,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    width: '100%',
  },
  error: {
    color: '#FCA5A5',
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_500Medium',
  },
  buttonShadow: {
    width: '100%',
    alignSelf: 'stretch',
    borderRadius: radius.md,
    marginTop: spacing.xs,
    shadowColor: '#02060F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 5,
  },
  button: {
    width: '100%',
    minHeight: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.55 },
});
