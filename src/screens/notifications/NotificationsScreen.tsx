import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useNotifications } from '../../context/NotificationContext';
import { NotificationItem } from '../../types/api';

interface NotificationsScreenProps {
  onClose: () => void;
}

function formatTimeLabel(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function NotificationsScreen({ onClose }: NotificationsScreenProps) {
  const insets = useSafeAreaInsets();
  const { items, unreadCount, isLoading, isBackendAvailable, refresh, markAllRead, openTarget } = useNotifications();
  const isEmpty = items.length === 0;
  const title = useMemo(() => (
    unreadCount > 0 ? `Notifications (${unreadCount})` : 'Notifications'
  ), [unreadCount]);

  const renderItem = ({ item }: { item: NotificationItem }) => (
    <TouchableOpacity
      style={[styles.card, !item.isRead && styles.cardUnread]}
      onPress={() => openTarget(item)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        {!item.isRead && <View style={styles.unreadDot} />}
      </View>
      <Text style={styles.cardBody}>{item.body}</Text>
      <Text style={styles.cardMeta}>{formatTimeLabel(item.createdAt)}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.headerIconButton} accessibilityLabel="Close notifications">
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <TouchableOpacity
          onPress={() => void markAllRead()}
          style={styles.headerActionButton}
          disabled={unreadCount === 0}
        >
          <Text style={[styles.headerActionText, unreadCount === 0 && styles.headerActionTextDisabled]}>
            Mark read
          </Text>
        </TouchableOpacity>
      </View>

      {!isBackendAvailable && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Notifications backend is not available yet. Showing cached items.</Text>
        </View>
      )}

      {isLoading && isEmpty ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.notificationId}
          renderItem={renderItem}
          contentContainerStyle={[styles.listContent, isEmpty && styles.emptyListContent]}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => void refresh()} />}
          ListEmptyComponent={<Text style={styles.emptyText}>No notifications yet.</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginLeft: 6,
  },
  headerActionButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  headerActionTextDisabled: {
    color: COLORS.textDisabled,
  },
  banner: {
    backgroundColor: '#FFF4D6',
    borderBottomWidth: 1,
    borderBottomColor: '#F4E0A2',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 12,
    gap: 10,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 6,
  },
  cardUnread: {
    borderColor: COLORS.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
  },
  cardBody: {
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  cardMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
