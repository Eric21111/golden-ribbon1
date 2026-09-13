import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { managerColors, managerGradients, tileGradients } from './theme';

interface RouteStop {
  label: string;
  /** Main Branch gets the navy/blue "business" badge; a selling branch gets the gold "storefront" badge. */
  isMain: boolean;
}

interface RouteBannerProps {
  from: RouteStop;
  to: RouteStop;
  /** Icon shown in the connector between the two stops — pick one that matches the direction (e.g. paper-plane for an outgoing send, return-up-back for stock coming back). */
  connectorIcon: IoniconsIconName;
}

function StopBadge({ isMain }: { isMain: boolean }) {
  return (
    <LinearGradient
      colors={isMain ? tileGradients.blue : tileGradients.gold}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.routeBadge}
    >
      <Ionicons
        name={isMain ? 'business-outline' : 'storefront-outline'}
        size={22}
        color={isMain ? managerColors.royalBlue : managerColors.goldMuted}
      />
    </LinearGradient>
  );
}

export function RouteBanner({ from, to, connectorIcon }: RouteBannerProps) {
  return (
    <View style={styles.routeCard}>
      <View style={styles.routeRow}>
        <View style={styles.routeStop}>
          <StopBadge isMain={from.isMain} />
          <Text style={styles.routeStopLabel} numberOfLines={1}>
            {from.label}
          </Text>
        </View>
        <View style={styles.routeConnector}>
          <View style={styles.routeLine} />
          <LinearGradient
            colors={managerGradients.hero}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.routeIconChip}
          >
            <Ionicons name={connectorIcon} size={18} color="#FFFFFF" />
          </LinearGradient>
          <View style={styles.routeLine} />
        </View>
        <View style={styles.routeStop}>
          <StopBadge isMain={to.isMain} />
          <Text style={styles.routeStopLabel} numberOfLines={1}>
            {to.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderColor: managerColors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 1,
  },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  routeStop: { flex: 1, alignItems: 'center', gap: 8 },
  routeBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  routeStopLabel: { color: managerColors.ink, fontFamily: 'Inter_600SemiBold', fontSize: 13, maxWidth: '100%' },
  routeConnector: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  routeLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: '#D3E3FC' },
  routeIconChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: managerColors.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
});
