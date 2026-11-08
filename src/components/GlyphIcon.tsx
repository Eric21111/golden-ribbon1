import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { StyleSheet, View } from 'react-native';

/**
 * Icons the app draws itself because Ionicons has no matching glyph (and the app has no SVG library or second icon font).
 * Add a name here and a drawing below; everything else is an Ionicons name.
 */
export type CustomGlyphName = 'bbq-stick';
export type GlyphName = IoniconsIconName | CustomGlyphName;

export function isCustomGlyph(name: GlyphName): name is CustomGlyphName {
  return name === 'bbq-stick';
}

/** A skewer: a thin stick set diagonally with three pieces of meat on it. Fits a square of `size` like an Ionicon. */
function BbqStick({ size, color }: { size: number; color: string }) {
  const stickWidth = Math.max(1.5, size * 0.09);
  const pieceWidth = size * 0.42;
  const pieceHeight = size * 0.2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.box, { width: size, height: size }]}
    >
      <View style={[styles.turned, { width: size, height: size * 1.15 }]}>
        <View style={[styles.stick, { width: stickWidth, backgroundColor: color, borderRadius: stickWidth }]} />
        <View style={[styles.pieces, { paddingTop: size * 0.1, gap: size * 0.05 }]}>
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={{ width: pieceWidth, height: pieceHeight, borderRadius: size * 0.09, backgroundColor: color }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export function GlyphIcon({ name, size, color }: { name: GlyphName; size: number; color: string }) {
  if (isCustomGlyph(name)) return <BbqStick size={size} color={color} />;
  return <Ionicons name={name} size={size} color={color} />;
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  turned: { alignItems: 'center', transform: [{ rotate: '45deg' }] },
  stick: { position: 'absolute', top: 0, bottom: 0 },
  pieces: { alignItems: 'center' },
});
