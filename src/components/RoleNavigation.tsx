import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { Link, usePathname, type Href } from 'expo-router';
import { createContext, useContext, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { managerColors } from '@/components/dashboard/theme';
import { colors } from '@/constants/theme';
import { useAuth } from '@/features/auth/AuthProvider';
import { isMainBranchManager } from '@/features/auth/roles';
import { useKeyboardBottomInset } from '@/hooks/useKeyboardBottomInset';
import type { UserRole } from '@/types/models';

type NavigationItem = {
  label: string;
  href: Href;
  icon: IoniconsIconName;
  selectedIcon: IoniconsIconName;
};

function menuHref(href: string): Href {
  return href as Href;
}

const ownerMenu: NavigationItem[] = [
  { label: 'Home', href: menuHref('/owner/dashboard'), icon: 'home-outline', selectedIcon: 'home' },
  { label: 'Reports', href: menuHref('/owner/reports'), icon: 'stats-chart-outline', selectedIcon: 'stats-chart' },
  { label: 'Performance', href: menuHref('/owner/reports/branch-performance'), icon: 'git-branch-outline', selectedIcon: 'git-branch' },
  { label: 'Reconcile', href: menuHref('/owner/reports/inventory-reconciliation'), icon: 'checkmark-done-outline', selectedIcon: 'checkmark-done' },
  { label: 'Discrepancies', href: menuHref('/owner/reports/discrepancies'), icon: 'alert-circle-outline', selectedIcon: 'alert-circle' },
  { label: 'Employees', href: menuHref('/owner/employees'), icon: 'people-outline', selectedIcon: 'people' },
  { label: 'Account', href: menuHref('/owner/profile'), icon: 'person-circle-outline', selectedIcon: 'person-circle' },
];

const mainManagerMenu: NavigationItem[] = [
  { label: 'Home', href: menuHref('/manager/dashboard'), icon: 'home-outline', selectedIcon: 'home' },
  { label: 'Products', href: menuHref('/manager/products'), icon: 'fast-food-outline', selectedIcon: 'fast-food' },
  { label: 'Branches', href: menuHref('/manager/branches'), icon: 'git-branch-outline', selectedIcon: 'git-branch' },
  { label: 'Inventory', href: menuHref('/manager/inventory'), icon: 'cube-outline', selectedIcon: 'cube' },
  { label: 'Transfers', href: menuHref('/manager/transfers'), icon: 'swap-horizontal-outline', selectedIcon: 'swap-horizontal' },
  { label: 'Returns', href: menuHref('/manager/returns'), icon: 'return-up-back-outline', selectedIcon: 'return-up-back' },
];

const sellingManagerMenu: NavigationItem[] = [
  { label: 'Home', href: menuHref('/manager/dashboard'), icon: 'home-outline', selectedIcon: 'home' },
  { label: 'Inventory', href: menuHref('/manager/inventory'), icon: 'cube-outline', selectedIcon: 'cube' },
  { label: 'Incoming', href: menuHref('/manager/incoming'), icon: 'download-outline', selectedIcon: 'download' },
  { label: 'Returns', href: menuHref('/manager/returns'), icon: 'return-up-back-outline', selectedIcon: 'return-up-back' },
];

const cashierMenu: NavigationItem[] = [
  { label: 'Home', href: '/cashier/dashboard', icon: 'home-outline', selectedIcon: 'home' },
  { label: 'POS', href: '/cashier/pos', icon: 'cart-outline', selectedIcon: 'cart' },
  { label: 'Sales', href: '/cashier/sales', icon: 'receipt-outline', selectedIcon: 'receipt' },
  { label: 'Profile', href: '/cashier/profile', icon: 'person-circle-outline', selectedIcon: 'person-circle' },
];

const BottomNavigationContext = createContext(false);

export function useBottomNavigationVisible() {
  return useContext(BottomNavigationContext);
}

export function RoleNavigation({ role, children }: PropsWithChildren<{ role: UserRole }>) {
  const { profile } = useAuth();
  const pathname = usePathname().replace(/\/$/, '');
  const items =
    role === 'owner'
      ? ownerMenu
      : role === 'manager'
        ? isMainBranchManager(profile)
          ? mainManagerMenu
          : sellingManagerMenu
        : cashierMenu;
  const keyboardInset = useKeyboardBottomInset();
  // Only primary pages have a menu. Forms, details, and inventory drill-downs
  // keep their existing stack navigation back to the parent page.
  const visible = items.some((item) => item.href === pathname);
  const showNav = visible && keyboardInset === 0;
  const activeColor = role === 'manager' ? managerColors.royalBlue : colors.primary;
  const indicatorColor = role === 'manager' ? managerColors.gold : colors.primary;
  // Inter is only loaded for the manager route group's fonts — scope the font-family
  // override to manager so owner/cashier keep their existing system-font label exactly.
  const labelFontFamily = role === 'manager' ? 'Inter_600SemiBold' : undefined;
  const selectedLabelFontFamily = role === 'manager' ? 'Inter_700Bold' : undefined;

  return (
    <BottomNavigationContext.Provider value={visible}>
      <View style={styles.layout}>
        <View style={styles.content}>{children}</View>
        {showNav ? (
          <SafeAreaView
            edges={['bottom', 'left', 'right']}
            style={[styles.footer, role === 'manager' && styles.footerFloating]}
          >
            <View
              style={[styles.menu, role === 'manager' && styles.menuFloating]}
              accessibilityLabel={`${role} navigation`}
            >
              {items.map((item) => {
                const selected = item.href === pathname;
                return (
                  <Link
                    key={String(item.href)}
                    href={item.href}
                    replace
                    asChild
                    style={styles.linkItem}
                  >
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={item.label}
                      accessibilityState={{ selected }}
                      onPress={(event) => { if (selected) event.preventDefault(); }}
                      style={({ pressed }) => StyleSheet.flatten([
                        styles.item,
                        selected && role !== 'manager' && styles.selectedItem,
                        pressed && styles.pressed,
                      ])}
                    >
                      {role !== 'manager' ? (
                        <View style={[styles.indicator, selected && { backgroundColor: indicatorColor }]} />
                      ) : null}
                      <View style={[styles.iconChip, selected && role === 'manager' && styles.iconChipActive]}>
                        <Ionicons
                          accessibilityElementsHidden
                          color={selected ? activeColor : colors.muted}
                          name={selected ? item.selectedIcon : item.icon}
                          size={22}
                        />
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.label,
                          labelFontFamily && { fontFamily: labelFontFamily },
                          selected && styles.selectedLabel,
                          selected && { color: activeColor },
                          selected && selectedLabelFontFamily && { fontFamily: selectedLabelFontFamily },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  </Link>
                );
              })}
            </View>
          </SafeAreaView>
        ) : null}
      </View>
    </BottomNavigationContext.Provider>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, minHeight: 0 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerFloating: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  menu: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  menuFloating: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#0A1224',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
  },
  linkItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  item: {
    flex: 1,
    width: '100%',
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: 2,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 8,
  },
  selectedItem: { backgroundColor: colors.background },
  pressed: { opacity: 0.65 },
  indicator: { width: 20, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 5,
    borderRadius: 14,
  },
  iconChipActive: { backgroundColor: '#EAF0FB' },
  label: { color: colors.muted, fontSize: 10, fontWeight: '600', textAlign: 'center', width: '100%' },
  selectedLabel: { fontWeight: '800' },
});
