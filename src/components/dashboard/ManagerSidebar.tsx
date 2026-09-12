import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignOutButton } from '@/components/SignOutButton';
import { useAuth } from '@/features/auth/AuthProvider';

import { managerColors, managerGradients } from './theme';

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

const groups: SidebarGroup[] = [
  {
    title: 'MENU',
    items: [
      { label: 'Home', href: '/manager/dashboard', icon: 'home-outline', selectedIcon: 'home' },
      { label: 'Inventory', href: '/manager/inventory', icon: 'cube-outline', selectedIcon: 'cube' },
      { label: 'Incoming', href: '/manager/incoming', icon: 'download-outline', selectedIcon: 'download' },
      { label: 'Returns', href: '/manager/returns', icon: 'return-up-back-outline', selectedIcon: 'return-up-back' },
      { label: 'Products', href: '/manager/products', icon: 'fast-food-outline', selectedIcon: 'fast-food' },
    ],
  },
  {
    title: 'REPORTS',
    items: [
      {
        label: 'Branch Product Sales',
        href: '/manager/reports/product-sales',
        icon: 'bar-chart-outline',
        selectedIcon: 'bar-chart',
      },
      { label: 'Sales History', href: '/manager/sales', icon: 'time-outline', selectedIcon: 'time' },
      { label: 'Shift History', href: '/manager/shifts', icon: 'people-outline', selectedIcon: 'people' },
      {
        label: 'Inventory History',
        href: '/manager/movements',
        icon: 'swap-vertical-outline',
        selectedIcon: 'swap-vertical',
      },
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

interface ManagerSidebarProps {
  onClose: () => void;
  onNavigate: () => void;
}

export function ManagerSidebar({ onClose, onNavigate }: ManagerSidebarProps) {
  const { profile } = useAuth();
  const pathname = usePathname().replace(/\/$/, '');

  const managerName = profile?.full_name ?? 'Manager';
  const branchName = profile?.branch?.name ?? 'Unassigned';

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
        <SafeAreaView edges={['top']}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            hitSlop={12}
            onPress={onClose}
            style={styles.closeButton}
          >
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.identity}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {managerName}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              Branch Manager · {branchName}
            </Text>
          </View>
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
        <SignOutButton variant="danger" labelStyle={styles.logoutLabel} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  closeButton: { alignSelf: 'flex-end', padding: 4, marginTop: 8 },
  identity: { alignItems: 'flex-start', gap: 4, marginTop: 4 },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  name: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 18 },
  subtitle: { color: 'rgba(255, 255, 255, 0.75)', fontFamily: 'Inter_400Regular', fontSize: 13 },
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
  },
  logoutLabel: { fontFamily: 'Inter_700Bold' },
});
