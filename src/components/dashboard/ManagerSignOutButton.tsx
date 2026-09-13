import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSignOut } from '@/features/auth/useSignOut';

import { managerColors } from './theme';

export function ManagerSignOutButton() {
  const { confirmSignOut, isSigningOut, error } = useSignOut();

  return (
    <>
      {error ? <Text style={styles.error}>Could not log out. {error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={isSigningOut}
        onPress={confirmSignOut}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, isSigningOut && styles.disabled]}
      >
        {isSigningOut ? (
          <ActivityIndicator color={managerColors.ink} />
        ) : (
          <View style={styles.content}>
            <Ionicons name="log-out-outline" size={18} color={managerColors.ink} />
            <Text style={styles.label}>Log out</Text>
          </View>
        )}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: managerColors.cardBorder,
    backgroundColor: managerColors.cardSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: managerColors.ink, fontFamily: 'Inter_700Bold', fontSize: 15 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.6 },
  error: { color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginBottom: 8 },
});
