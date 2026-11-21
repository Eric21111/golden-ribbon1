import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

interface CurrencyTextProps {
  value: string | number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
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
}: CurrencyTextProps) {
  const text = String(value);
  const match = text.match(/^[^\d-]+/);
  const symbol = match?.[0] ?? '';
  const amount = text.slice(symbol.length);
  const flat = StyleSheet.flatten(style) ?? {};
  const { fontFamily, ...rest } = flat;
  const shrink = Boolean(adjustsFontSizeToFit);
  const isCurrency = /₱/.test(text) || /[\d,]+\.\d{2}\s*$/.test(text);

  return (
    <Text
      style={rest}
      numberOfLines={numberOfLines}
      adjustsFontSizeToFit={shrink}
      minimumFontScale={minimumFontScale ?? (isCurrency ? 0.85 : 0.65)}
      ellipsizeMode={isCurrency ? 'clip' : 'tail'}
    >
      {symbol ? <Text style={rest}>{symbol}</Text> : null}
      <Text style={fontFamily ? [rest, { fontFamily }] : rest}>{amount}</Text>
    </Text>
  );
}
