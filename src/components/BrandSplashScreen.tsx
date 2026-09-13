import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { managerGradients } from '@/components/dashboard/theme';

const logo = require('../../assets/Golden_Ribbon_Logo-removebg-preview.png');

interface BrandSplashScreenProps {
  /** Shown under the logo with a spinner. Omit for a plain branded screen with no spinner. */
  label?: string;
}

/** Full-bleed navy → royal-blue gradient with the brand logo centered — the JS-rendered
 * equivalent of a splash screen, shown while the app determines where to route the user. */
export function BrandSplashScreen({ label }: BrandSplashScreenProps) {
  return (
    <LinearGradient colors={managerGradients.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.container}>
      <Image source={logo} resizeMode="contain" style={styles.logo} />
      {label ? (
        <View style={styles.footer}>
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.label}>{label}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 },
  logo: { width: 160, height: 160 },
  footer: { alignItems: 'center', gap: 12 },
  label: { color: 'rgba(255, 255, 255, 0.85)', fontFamily: 'Inter_500Medium', fontSize: 14 },
});
