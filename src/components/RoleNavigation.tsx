import Ionicons, { type IoniconsIconName } from '@react-native-vector-icons/ionicons';
import { Link, usePathname, type Href } from 'expo-router';
import { createContext, useContext, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { managerColors } from '@/components/dashboard/theme';
import { colors } from '@/constants/theme';
import { useKeyboardBottomInset } from '@/hooks/useKeyboardBottomInset';
import type { UserRole } from '@/types/models';

type NavigationItem = {
  label: string;
  href: Href;
  icon: IoniconsIconName;
  selectedIcon: IoniconsIconName;
};

const menus: Record<UserRole, NavigationItem[]> = {
  owner: [
    { label: 'Home', href: '/owner/dashboard', icon: 'home-outline', selectedIcon: 'home' },
    { label: 'Inventory', href: '/owner/inventory', icon: 'cube-outline', selectedIcon: 'cube' },
    { label: 'Transfers', href: '/owner/transfers', icon: 'swap-horizontal-outline', selectedIcon: 'swap-horizontal' },
    { label: 'Branches', href: '/owner/branches', icon: 'storefront-outline', selectedIcon: 'storefront' },
    { label: 'Products', href: '/owner/products', icon: 'fast-food-outline', selectedIcon: 'fast-food' },
    { label: 'Employees', href: '/owner/employees', icon: 'people-outline', selectedIcon: 'people' },
    { label: 'Profile', href: '/owner/profile', icon: 'person-circle-outline', selectedIcon: 'person-circle' },
  ],
  manager: [
    { label: 'Home', href: '/manager/dashboard', icon: 'home-outline', selectedIcon: 'home' },
    { label: 'Inventory', href: '/manager/inventory', icon: 'cube-outline', selectedIcon: 'cube' },
    { label: 'Incoming', href: '/manager/incoming', icon: 'download-outline', selectedIcon: 'download' },
    { label: 'Returns', href: '/manager/returns', icon: 'return-up-back-outline', selectedIcon: 'return-up-back' },
    { label: 'Products', href: '/manager/products', icon: 'fast-food-outline', selectedIcon: 'fast-food' },
  ],
  cashier: [
    { label: 'Home', href: '/cashier/dashboard', icon: 'home-outline', selectedIcon: 'home' },
    { label: 'POS', href: '/cashier/pos', icon: 'cart-outline', selectedIcon: 'cart' },
    { label: 'Sales', href: '/cashier/sales', icon: 'receipt-outline', selectedIcon: 'receipt' },
    { label: 'Profile', href: '/cashier/profile', icon: 'person-circle-outline', selectedIcon: 'person-circle' },
  ],
};

const BottomNavigationContext = createContext(false);

export function useBottomNavigationVisible() {
  return useContext(BottomNavigationContext);
}

export function RoleNavigation({ role, children }: PropsWithChildren<{ role: UserRole }>) {
  const pathname = usePathname().replace(/\/$/, '');
  const items = menus[role];
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
          <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.footer}>
            <View style={styles.menu} accessibilityLabel={`${role} navigation`}>
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
                        selected && styles.selectedItem,
                        pressed && styles.pressed,
                      ])}
                    >
                      <View
                        style={[styles.indicator, selected && { backgroundColor: indicatorColor }]}
                      />
                      <Ionicons
                        accessibilityElementsHidden
                        color={selected ? activeColor : colors.muted}
                        name={selected ? item.selectedIcon : item.icon}
                        size={22}
                      />
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
  label: { color: colors.muted, fontSize: 10, fontWeight: '600', textAlign: 'center', width: '100%' },
  selectedLabel: { fontWeight: '800' },
});
