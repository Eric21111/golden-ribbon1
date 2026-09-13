import Ionicons from '@react-native-vector-icons/ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HamburgerButton } from './HamburgerButton';
import { managerColors } from './theme';

interface ManagerScreenHeaderProps {
  title: string;
  subtitle?: string;
  /** Drill-down/detail/create screens get a back button instead of the hamburger. */
  showBack?: boolean;
  /** Optional status badge shown inline with the subtitle — keeps it anchored to the record's identity instead of floating in the body. */
  badge?: ReactNode;
}

export function ManagerScreenHeader({ title, subtitle, showBack = false, badge }: ManagerScreenHeaderProps) {
  if (showBack) {
    return (
      <View style={styles.header}>
        <View style={styles.backRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={14}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={managerColors.ink} />
          </Pressable>
          <View style={styles.backTitleBlock}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle || badge ? (
              <View style={styles.metaRow}>
                {subtitle ? (
                  <Text style={[styles.subtitle, Boolean(badge) && styles.subtitleFlex]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
                {badge}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <HamburgerButton />
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
  backRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  backTitleBlock: { flex: 1, gap: 4, minWidth: 0 },
  backButton: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subtitleFlex: { flex: 1 },
  pressed: { opacity: 0.6 },
  titleBlock: { gap: 2 },
  title: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 22 },
  subtitle: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 13 },
});
