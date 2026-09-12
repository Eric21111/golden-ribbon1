import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HamburgerButton } from './HamburgerButton';
import { managerColors } from './theme';

interface ManagerScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Drill-down/detail/create screens get a back button instead of the hamburger. */
  showBack?: boolean;
}

export function ManagerScreenHeader({ title, subtitle, showBack = false }: ManagerScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={14}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={managerColors.ink} />
          </Pressable>
        ) : (
          <HamburgerButton />
        )}
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: managerColors.cardBorder,
  },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  backButton: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  titleBlock: { gap: 2 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22 },
  subtitle: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
});
