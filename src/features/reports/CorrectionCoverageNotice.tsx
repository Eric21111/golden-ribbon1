import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { managerColors } from '@/components/dashboard/theme';

/**
 * Said whenever stock correction figures were built from only the newest corrections (the server can only list pages), so partial
 * numbers are never read as complete ones. When older corrections can still be loaded, "Load older corrections" is right here.
 */
export function CorrectionCoverageNotice({
  message,
  onLoadOlder,
  loading = false,
  error,
}: {
  message: string;
  /** Present when older corrections can still be loaded. */
  onLoadOlder?: () => void;
  loading?: boolean;
  /** Why the last attempt to load older corrections failed (what is already loaded is kept). */
  error?: string | null;
}) {
  return (
    <View style={styles.wrap}>
      <View accessibilityRole="alert" style={styles.box}>
        <Ionicons name="information-circle-outline" size={20} color={managerColors.goldMuted} />
        <Text style={styles.text}>{message}</Text>
      </View>
      {error ? <Text style={styles.error}>{`Couldn’t load older corrections. ${error}`}</Text> : null}
      {onLoadOlder ? (
        <ManagerActionButton
          label="Load older corrections"
          icon="time-outline"
          variant="secondary"
          loading={loading}
          disabled={loading}
          onPress={onLoadOlder}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#FEF7E0',
    borderWidth: 1,
    borderColor: '#F3E2A9',
  },
  text: { flex: 1, minWidth: 0, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12.5 },
});
