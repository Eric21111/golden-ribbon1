import { useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { managerColors } from '@/components/dashboard/theme';
import Ionicons from '@react-native-vector-icons/ionicons';

const BOX_GAP = 8;
const BOX_COUNT = 6;

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  accentColor?: string;
  labelStyle?: StyleProp<TextStyle>;
  errorStyle?: StyleProp<TextStyle>;
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
  appearance?: 'default' | 'dark';
  /** Forms that are not laid out around reserved error space: with no error or hint there is no empty strip under the boxes. */
  compact?: boolean;
};

export function PinField({
  label,
  value,
  onChangeText,
  error,
  accentColor = managerColors.royalBlue,
  labelStyle,
  errorStyle,
  hint,
  required = false,
  autoFocus = false,
  appearance = 'default',
  compact = false,
}: Props) {
  const isDark = appearance === 'dark';
  const refs = useRef<Array<TextInput | null>>([]);
  const [focused, setFocused] = useState(-1);
  const [revealed, setRevealed] = useState(false);

  const meta = error ? (
    <Text accessibilityRole="alert" style={[styles.metaText, styles.error, isDark && styles.errorDark, errorStyle]}>
      {error}
    </Text>
  ) : hint ? (
    <Text style={[styles.metaText, styles.hint, isDark && styles.hintDark]}>{hint}</Text>
  ) : (
    <Text style={[styles.metaText, styles.metaSpacer]}> </Text>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, isDark && styles.labelDark, labelStyle]}>
          {label}
          {required ? <Text style={[styles.required, isDark && styles.requiredDark]}> *</Text> : null}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={revealed ? 'Hide PIN' : 'Show PIN'}
          hitSlop={10}
          onPress={() => setRevealed((prev) => !prev)}
          style={({ pressed }) => [styles.eyeHit, pressed && styles.pressed]}
        >
          <Ionicons
            name={revealed ? 'eye-outline' : 'eye-off-outline'}
            size={20}
            color={isDark ? '#E7ECFA' : managerColors.subtext}
          />
        </Pressable>
      </View>
      <View style={styles.boxes}>
        {Array.from({ length: BOX_COUNT }, (_, index) => {
          const isFocused = focused === index;
          const hasError = Boolean(error);
          return (
            <View key={index} style={[styles.boxSlot, compact && styles.boxSlotCompact]}>
              <TextInput
                ref={(el) => {
                  refs.current[index] = el;
                }}
                accessibilityLabel={`${label}, digit ${index + 1} of 6`}
                style={[
                  styles.box,
                  isDark && styles.boxDark,
                  isFocused && !hasError && { borderColor: accentColor },
                  hasError && styles.boxError,
                ]}
                value={value[index] ?? ''}
                secureTextEntry={!revealed}
                keyboardType="number-pad"
                selectTextOnFocus
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                autoFocus={autoFocus && index === 0}
                onFocus={() => {
                  setFocused(index);
                  if (index > value.length) refs.current[value.length]?.focus();
                }}
                onBlur={() => setFocused(-1)}
                onKeyPress={({ nativeEvent }) => {
                  if (nativeEvent.key === 'Backspace' && !value[index] && index > 0) {
                    onChangeText(value.slice(0, index - 1));
                    refs.current[index - 1]?.focus();
                  }
                }}
                onChangeText={(digits) => {
                  if (!/^[0-9]*$/.test(digits)) return;
                  if (!digits) {
                    onChangeText(value.slice(0, index) + value.slice(index + 1));
                    refs.current[Math.max(0, index - 1)]?.focus();
                    return;
                  }
                  const part = digits.slice(0, BOX_COUNT - index);
                  onChangeText((value.slice(0, index) + part + value.slice(index + part.length)).slice(0, BOX_COUNT));
                  refs.current[Math.min(BOX_COUNT - 1, index + part.length)]?.focus();
                }}
              />
            </View>
          );
        })}
      </View>
      {compact && !error && !hint ? null : <View style={compact ? styles.metaCompact : styles.meta}>{meta}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 20,
    width: '100%',
  },
  label: {
    color: managerColors.ink,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
    flex: 1,
  },
  labelDark: { color: '#F3F6FF', letterSpacing: 0.2 },
  required: {
    color: '#B91C1C',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
  },
  requiredDark: { color: '#F87171' },
  eyeHit: {
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxes: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    maxWidth: '100%',
    gap: BOX_GAP,
  },
  boxSlot: {
    flex: 1,
    minWidth: 0,
    aspectRatio: 1,
  },
  boxSlotCompact: { aspectRatio: undefined, height: 48 },
  box: {
    flex: 1,
    width: '100%',
    height: '100%',
    minWidth: 0,
    textAlign: 'center',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    color: managerColors.ink,
    borderWidth: 1.5,
    borderRadius: 12,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    padding: 0,
  },
  boxDark: {
    color: '#FFFFFF',
    borderColor: 'rgba(198, 210, 232, 0.78)',
    backgroundColor: 'rgba(10, 18, 36, 0.5)',
  },
  boxError: { borderColor: '#F87171' },
  meta: {
    minHeight: 28,
    justifyContent: 'center',
    width: '100%',
  },
  metaCompact: { justifyContent: 'center', width: '100%' },
  metaText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 16,
  },
  metaSpacer: { color: 'transparent' },
  hint: {
    color: managerColors.subtext,
    fontFamily: 'Inter_400Regular',
    fontWeight: '400',
  },
  hintDark: { color: '#C5D0E6' },
  error: {
    color: '#B91C1C',
  },
  errorDark: { color: '#FCA5A5' },
  pressed: { opacity: 0.7 },
});
