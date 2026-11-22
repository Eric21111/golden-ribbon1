import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

interface CurrencyTextProps {
  value: string | number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  /** Caps how far the system font scale may grow this text (a big figure in a tile). */
  maxFontSizeMultiplier?: number;
}

/**
 * Inter doesn't ship a ₱ glyph, so it silently falls back to the system font for
 * just that character — next to Inter digits that reads as a broken/strikethrough
 * glyph. Rendering the leading currency symbol in the system font (everything else
 * stays Inter) avoids the mixed-font artifact.
 */
export function CurrencyText({
  value,
  style,
  numberOfLines,
  adjustsFontSizeToFit,
  minimumFontScale,
  maxFontSizeMultiplier,
}: CurrencyTextProps) {
  const text = String(value);
  const match = text.match(/^[^\d-]+/);
  const symbol = match?.[0] ?? '';
  const amount = text.slice(symbol.length);
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontFamily, ...rest } = flat;
  const shrink = Boolean(adjustsFontSizeToFit);
  const isCurrency = /₱/.test(text) || /[\d,]+\.\d{2}\s*$/.test(text);

  // An amount is never cut off: it shrinks to fit (down to 60%), and the callers stack their tiles first when it would
  // need to shrink more than that. Without a line limit it simply wraps, so nothing is ever replaced by "…".
  return (
    <Text
      style={rest}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={shrink}
      minimumFontScale={minimumFontScale ?? 0.6}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      ellipsizeMode={isCurrency ? 'clip' : 'tail'}
    >
      {/* The inner pieces carry no font size of their own (only the font family): a size set on them would stay fixed when the
          outer text shrinks to fit, and Android would cut the amount off instead of shrinking it. */}
      {symbol ? <Text>{symbol}</Text> : null}
      <Text style={fontFamily ? { fontFamily } : undefined}>{amount}</Text>
    </Text>
  );
}
