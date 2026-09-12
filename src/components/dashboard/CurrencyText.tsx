import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

interface CurrencyTextProps {
  value: string | number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
}

/**
 * Inter doesn't ship a ₱ glyph, so it silently falls back to the system font for
 * just that character — next to Inter digits that reads as a broken/strikethrough
 * glyph. Rendering the leading currency symbol in the system font (everything else
 * stays Inter) avoids the mixed-font artifact.
 */
export function CurrencyText({ value, style, numberOfLines, adjustsFontSizeToFit }: CurrencyTextProps) {
  const text = String(value);
  const match = text.match(/^[^\d-]+/);
  const symbol = match?.[0] ?? '';
  const amount = text.slice(symbol.length);
  const { fontFamily: _fontFamily, ...symbolStyle } = StyleSheet.flatten(style) ?? {};

  return (
    <Text numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit}>
      {symbol ? <Text style={symbolStyle}>{symbol}</Text> : null}
      <Text style={style}>{amount}</Text>
    </Text>
  );
}
