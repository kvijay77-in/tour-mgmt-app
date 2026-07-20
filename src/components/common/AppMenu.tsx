/**
 * AppMenu - slide-in navigation menu for the Dashboard header.
 *
 * Custom slide-in panel (no drawer/reanimated dependency, per approved
 * migration decisions) driven by the RN Animated API. Panel width and
 * safe-area insets are computed at render time so it adapts across phone,
 * tablet and web form factors and to device rotation.
 *
 * See /docs/... and /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 3).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { AppStackParamList } from '../../types/navigation';

const ANIMATION_DURATION_MS = 220;
const MAX_PANEL_WIDTH = 340;
const PANEL_WIDTH_RATIO = 0.86;

type MenuRouteName =
  | 'ChangePassword'
  | 'RideStatusManagement'
  | 'UserOnboarding'
  | 'UserEnableDisable'
  | 'UserDelete'
  | 'UserModify';

export interface AppMenuProps {
  visible: boolean;
  onClose: () => void;
  isAdministrator: boolean;
  showPitStopContextOption: boolean;
  managedPitStopStageNumber: number | null;
  onOpenPitStopContextPicker: () => void;
  showSkippedToggle: boolean;
  isSkippedHighlightEnabled: boolean;
  onToggleSkippedHighlight: (value: boolean) => void;
  onLogout: () => void | Promise<void>;
}

export function AppMenu({
  visible,
  onClose,
  isAdministrator,
  showPitStopContextOption,
  managedPitStopStageNumber,
  onOpenPitStopContextPicker,
  showSkippedToggle,
  isSkippedHighlightEnabled,
  onToggleSkippedHighlight,
  onLogout,
}: AppMenuProps) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, 'Dashboard'>>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const panelWidth = Math.min(MAX_PANEL_WIDTH, windowWidth * PANEL_WIDTH_RATIO);

  const translateX = useRef(new Animated.Value(panelWidth)).current;
  const [isMounted, setIsMounted] = useState(visible);
  const [showUserManagementSubmenu, setShowUserManagementSubmenu] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
      translateX.setValue(panelWidth);
      Animated.timing(translateX, {
        toValue: 0,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }).start();
      return;
    }

    if (isMounted) {
      Animated.timing(translateX, {
        toValue: panelWidth,
        duration: ANIMATION_DURATION_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setIsMounted(false);
          setShowUserManagementSubmenu(false);
        }
      });
    }
    // isMounted intentionally excluded to avoid re-triggering the close animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, panelWidth, translateX]);

  const navigateTo = (routeName: MenuRouteName) => {
    onClose();
    navigation.navigate(routeName);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlayContainer}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              transform: [{ translateX }],
            },
          ]}
        >
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <MaterialIcons name="close" size={22} color={COLORS.textSecondary} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem} onPress={() => navigateTo('ChangePassword')}>
            <MaterialIcons name="lock-reset" size={18} color={COLORS.textPrimary} />
            <Text style={styles.menuItemText}>Change password</Text>
          </TouchableOpacity>

          {isAdministrator && (
            <TouchableOpacity style={styles.menuItem} onPress={() => navigateTo('RideStatusManagement')}>
              <MaterialIcons name="route" size={18} color={COLORS.textPrimary} />
              <Text style={styles.menuItemText}>Ride status management</Text>
            </TouchableOpacity>
          )}

          {isAdministrator && (
            <View style={styles.sectionWrap}>
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => setShowUserManagementSubmenu((prev) => !prev)}
              >
                <MaterialIcons name="manage-accounts" size={18} color={COLORS.textPrimary} />
                <Text style={styles.menuItemText}>User Management</Text>
                <View style={styles.menuItemRightIconWrap}>
                  <MaterialIcons
                    name={showUserManagementSubmenu ? 'expand-less' : 'expand-more'}
                    size={18}
                    color={COLORS.textSecondary}
                  />
                </View>
              </TouchableOpacity>

              {showUserManagementSubmenu && (
                <View style={styles.submenuWrap}>
                  <TouchableOpacity style={styles.subItem} onPress={() => navigateTo('UserOnboarding')}>
                    <MaterialIcons name="person-add" size={16} color={COLORS.textPrimary} />
                    <Text style={styles.subItemText}>New user onboarding</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.subItem} onPress={() => navigateTo('UserEnableDisable')}>
                    <MaterialIcons name="toggle-on" size={16} color={COLORS.textPrimary} />
                    <Text style={styles.subItemText}>Enable / Disable user</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.subItem} onPress={() => navigateTo('UserDelete')}>
                    <MaterialIcons name="delete-outline" size={16} color={COLORS.danger} />
                    <Text style={styles.subItemDangerText}>Delete user</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.subItem} onPress={() => navigateTo('UserModify')}>
                    <MaterialIcons name="edit" size={16} color={COLORS.textPrimary} />
                    <Text style={styles.subItemText}>Modify user</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {showPitStopContextOption && (
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                onClose();
                onOpenPitStopContextPicker();
              }}
            >
              <MaterialIcons name="tune" size={18} color={COLORS.textPrimary} />
              <Text style={styles.menuItemText}>
                Set pit stop context
                {managedPitStopStageNumber !== null ? ` (PS${managedPitStopStageNumber})` : ''}
              </Text>
            </TouchableOpacity>
          )}

          {showSkippedToggle && (
            <View style={styles.switchItem}>
              <View style={styles.switchLabelWrap}>
                <MaterialIcons name="warning-amber" size={18} color={COLORS.warning} />
                <Text style={styles.menuItemText}>Show skipped Check-In</Text>
              </View>
              <Switch
                value={isSkippedHighlightEnabled}
                onValueChange={onToggleSkippedHighlight}
                thumbColor={COLORS.white}
                trackColor={{ false: COLORS.gray[400], true: COLORS.primary }}
              />
            </View>
          )}

          <TouchableOpacity
            style={styles.menuItem}
            onPress={async () => {
              onClose();
              await onLogout();
            }}
          >
            <MaterialIcons name="logout" size={18} color={COLORS.textPrimary} />
            <Text style={styles.menuItemText}>Logout</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  panel: {
    backgroundColor: COLORS.white,
    height: '100%',
    paddingHorizontal: 4,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
    marginRight: 6,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  sectionWrap: {
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  menuItemRightIconWrap: {
    marginLeft: 'auto',
  },
  submenuWrap: {
    paddingBottom: 6,
    backgroundColor: COLORS.gray[50],
  },
  subItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
    paddingVertical: 10,
  },
  subItemText: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  subItemDangerText: {
    fontSize: 13,
    color: COLORS.danger,
    fontWeight: '500',
  },
  switchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  switchLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  menuItemText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
});
