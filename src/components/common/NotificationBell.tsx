import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { AppStackParamList } from '../../types/navigation';
import { useNotifications } from '../../context/NotificationContext';

interface NotificationBellProps {
  light?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function NotificationBell({ light = false, style }: NotificationBellProps) {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { unreadCount } = useNotifications();

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={() => navigation.navigate('Notifications')}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
    >
      <MaterialIcons name="notifications-none" size={22} color={light ? COLORS.white : COLORS.textPrimary} />
      {unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.danger,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: '700',
  },
});
