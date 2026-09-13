import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors } from '@/constants/theme';
import { useSignOut } from '@/features/auth/useSignOut';

type SignOutButtonProps = {
  variant?: 'primary' | 'secondary' | 'danger';
  labelStyle?: StyleProp<TextStyle>;
};

export function SignOutButton({ variant = 'secondary', labelStyle }: SignOutButtonProps) {
  const { confirmSignOut, isSigningOut, error } = useSignOut();

  return (
    <>
      {error ? <Text style={styles.error}>Could not log out. {error}</Text> : null}
      <AppButton
        label="Log out"
        loading={isSigningOut}
        onPress={confirmSignOut}
        variant={variant}
        labelStyle={labelStyle}
      />
    </>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
