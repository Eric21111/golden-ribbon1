import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';

import { ManagerSignOutButton } from './ManagerSignOutButton';
import { managerColors, managerGradients } from './theme';

const logoSource = require('../../../assets/Golden_Ribbon_Logo-removebg-preview.png');

type SidebarItem = {
  label: string;
  href: string;
  icon: IoniconsIconName;
  selectedIcon: IoniconsIconName;
};

type SidebarGroup = {
  title: string;
  items: SidebarItem[];
};

function getGroups(isMain: boolean): SidebarGroup[] {
  return [
    {
      title: 'MENU',
      items: [
        { label: 'Home', href: '/manager/dashboard', icon: 'home-outline', selectedIcon: 'home' },
        { label: 'Inventory', href: '/manager/inventory', icon: 'cube-outline', selectedIcon: 'cube' },
        { label: 'Incoming', href: '/manager/incoming', icon: 'download-outline', selectedIcon: 'download' },
        { label: 'Returns', href: '/manager/returns', icon: 'return-up-back-outline', selectedIcon: 'return-up-back' },
        // Product catalog management is limited to the Main Branch Manager.
        ...(isMain
          ? [{ label: 'Products', href: '/manager/products', icon: 'fast-food-outline', selectedIcon: 'fast-food' } as SidebarItem]
          : []),
      ],
    },
    {
      title: 'ACCOUNT',
      items: [
        {
          label: 'Account',
          href: '/manager/profile',
          icon: 'person-circle-outline',
          selectedIcon: 'person-circle',
        },
        {
          label: 'Change Password',
          href: '/manager/change-password',
          icon: 'key-outline',
          selectedIcon: 'key',
        },
      ],
    },
  ];
}

interface ManagerSidebarProps {
  onClose: () => void;
  onNavigate: () => void;
}

export function ManagerSidebar({ onClose, onNavigate }: ManagerSidebarProps) {
  const { profile } = useAuth();
  const pathname = usePathname().replace(/\/$/, '');
  const groups = getGroups(isMainBranchManager(profile));

  const go = (href: string) => {
    router.push(href as never);
    onNavigate();
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={managerGradients.hero}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      >
        <SafeAreaView edges={['top']} style={styles.headerRow}>
          <View style={styles.identity}>
            <Image source={logoSource} resizeMode="contain" style={styles.brandLogo} />
            <Text style={styles.brandName} numberOfLines={1}>
              Golden Ribbons
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            hitSlop={12}
            onPress={onClose}
            style={styles.closeButton}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </Pressable>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {groups.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            {group.items.map((item) => {
              const selected = item.href === pathname;
              return (
                <Pressable
                  key={item.href}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => go(item.href)}
                  style={({ pressed }) => [
                    styles.item,
                    selected && styles.itemSelected,
                    pressed && styles.itemPressed,
                  ]}
                >
                  {selected ? <View style={styles.activeBar} /> : null}
                  <Ionicons
                    name={selected ? item.selectedIcon : item.icon}
                    size={20}
                    color={selected ? managerColors.royalBlue : managerColors.subtext}
                  />
                  <Text style={[styles.itemLabel, selected && styles.itemLabelSelected]} numberOfLines={1}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <ManagerSignOutButton />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20, borderTopRightRadius: 24 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  closeButton: { padding: 4 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  brandLogo: { width: 36, height: 36 },
  brandName: { flexShrink: 1, color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 17 },
  list: { flex: 1 },
  listContent: { paddingVertical: 12 },
  group: { marginBottom: 18 },
  groupTitle: {
    color: managerColors.subtext,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.8,
    paddingHorizontal: 20,
    marginBottom: 6,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minHeight: 48,
  },
  itemSelected: { backgroundColor: '#EAF0FB' },
  itemPressed: { opacity: 0.7 },
  activeBar: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    width: 3,
    borderRadius: 2,
    backgroundColor: managerColors.gold,
  },
  itemLabel: { flex: 1, color: managerColors.ink, fontFamily: 'Inter_500Medium', fontSize: 15 },
  itemLabelSelected: { color: managerColors.royalBlue, fontFamily: 'Inter_600SemiBold' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: managerColors.cardBorder,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
});
