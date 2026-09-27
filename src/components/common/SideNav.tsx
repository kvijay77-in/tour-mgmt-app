/**
 * SideNav — persistent left sidebar for web at widths ≥ DESKTOP_MIN_WIDTH.
 *
 * Rendered beside the app stack (outside any screen), so it navigates via the
 * container ref and tracks the focused stack route from the root state.
 * Lists the same modules as the Home hub (src/navigation/modules.ts).
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { COLORS } from '../../constants/colors';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { useTour } from '../../context/TourContext';
import { navigationRef } from '../../navigation/navigationRef';
import {
  ModuleIconName,
  ModuleTarget,
  VisibleModuleSection,
  navigateToModuleAction,
} from '../../navigation/modules';

const HOME_TARGET: ModuleTarget = { route: 'Home', params: undefined };

function getFocusedStackRouteName(): string | undefined {
  if (!navigationRef.isReady()) return undefined;
  const state = navigationRef.getRootState();
  return state?.routes[state.index]?.name;
}

interface SideNavItemProps {
  title: string;
  icon: ModuleIconName;
  active: boolean;
  indented?: boolean;
  onPress: () => void;
}

function SideNavItem({ title, icon, active, indented, onPress }: SideNavItemProps) {
  return (
    <TouchableOpacity
      style={[styles.item, indented && styles.itemIndented, active && styles.itemActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: active }}
    >
      <MaterialIcons name={icon} size={18} color={active ? COLORS.primary : COLORS.textPrimary} />
      <Text style={[styles.itemText, active && styles.itemTextActive]} numberOfLines={1}>{title}</Text>
    </TouchableOpacity>
  );
}

export interface SideNavProps {
  sections: VisibleModuleSection[];
}

export default function SideNav({ sections }: SideNavProps) {
  const { requestLogout } = useSyncStatus();
  const { tour } = useTour();
  const [focusedRoute, setFocusedRoute] = useState<string | undefined>(getFocusedStackRouteName);

  useEffect(() => {
    const update = () => setFocusedRoute(getFocusedStackRouteName());
    update();
    return navigationRef.addListener('state', update);
  }, []);

  const go = (target: ModuleTarget) => {
    if (navigationRef.isReady()) {
      navigationRef.dispatch(navigateToModuleAction(target));
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={2}>{tour?.name ?? 'Tour Management'}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <SideNavItem
          title="Home"
          icon="home"
          active={focusedRoute === 'Home'}
          onPress={() => go(HOME_TARGET)}
        />

        {sections.map((section) => {
          let lastGroup: string | undefined;
          return (
            <View key={section.id} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              {section.entries.map((entry) => {
                const showGroupLabel = entry.group !== undefined && entry.group !== lastGroup;
                lastGroup = entry.group;
                return (
                  <View key={entry.id}>
                    {showGroupLabel && <Text style={styles.groupLabel}>{entry.group}</Text>}
                    <SideNavItem
                      title={entry.title}
                      icon={entry.icon}
                      indented={entry.group !== undefined}
                      active={focusedRoute === entry.target.route}
                      onPress={() => go(entry.target)}
                    />
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <SideNavItem
          title="Change password"
          icon="lock-reset"
          active={focusedRoute === 'ChangePassword'}
          onPress={() => {
            if (navigationRef.isReady()) {
              navigationRef.dispatch(CommonActions.navigate('ChangePassword'));
            }
          }}
        />
        <SideNavItem title="Logout" icon="logout" active={false} onPress={requestLogout} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 248,
    backgroundColor: COLORS.surface,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: COLORS.primary,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: 8,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  itemIndented: {
    paddingLeft: 28,
  },
  itemActive: {
    backgroundColor: COLORS.primary + '12',
  },
  itemText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  itemTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 4,
  },
});
