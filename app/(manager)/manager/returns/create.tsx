import { router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { ConstrainedWidth } from '@/components/ConstrainedWidth';
import { Screen } from '@/components/Screen';
import { ManagerActionButton } from '@/components/dashboard/ManagerActionButton';
import { ManagerScreenHeader } from '@/components/dashboard/ManagerScreenHeader';
import { managerColors } from '@/components/dashboard/theme';

export default function ManagerCreateReturnUnavailable() {
  return (
    <Screen backgroundColor="#FFFFFF" edges={['top']} contentContainerStyle={styles.screenContent}>
      <ManagerScreenHeader
        title="Create return unavailable"
        subtitle="Cashiers create leftover returns"
        showBack
      />
      <ConstrainedWidth style={styles.column}>
        <Text style={styles.body}>
          Leftover returns are created by cashiers. Managers can view returns, and the Main Branch
          Manager can receive them.
        </Text>
        <ManagerActionButton label="View returns" onPress={() => router.replace('/manager/returns')} />
      </ConstrainedWidth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1, padding: 0, gap: 0 },
  column: { padding: 20, gap: 12 },
  body: { color: managerColors.subtext, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
});
