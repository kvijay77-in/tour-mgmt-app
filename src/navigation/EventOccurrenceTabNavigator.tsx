/**
 * Tabbed event occurrence dashboard: Event progress | Scan. Tabs are shown per
 * permission (R-F); Scan only while the occurrence is ACTIVE. Mirrors
 * MainTabNavigator (bottom tab bar, swipe). See docs/design/events.md.
 */

import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { createMaterialTopTabNavigator, MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { EVENT_DASHBOARD_MESSAGES } from '../constants/eventMessages';
import { useAuth } from '../context/AuthContext';
import { useEventSession } from '../context/EventSessionContext';
import { OccurrenceDashboardProvider, useOccurrenceDashboard } from '../context/OccurrenceDashboardContext';
import { useOffline } from '../context/OfflineContext';
import { useTour } from '../context/TourContext';
import { OccurrenceStatus, Permission } from '../types/models';
import { AppStackParamList, EventOccurrenceTab, EventOccurrenceTabParamList } from '../types/navigation';
import { hasPermission } from '../utils/permissions';
import OfflineBanner from '../components/common/OfflineBanner';
import EventScreenHeader from '../components/events/EventScreenHeader';
import OccurrenceStatusBadge from '../components/events/OccurrenceStatusBadge';
import StatusBanner from '../components/events/StatusBanner';
import EventProgressTab from '../screens/events/EventProgressTab';
import EventScanTab from '../screens/events/EventScanTab';
import EventActivityLogTab from '../screens/events/EventActivityLogTab';

const Tab = createMaterialTopTabNavigator<EventOccurrenceTabParamList>();

const TAB_LABELS: Record<EventOccurrenceTab, string> = {
  Progress: 'Event progress',
  Scan: 'Scan',
  Log: 'Activity Log',
};

type Navigation = NativeStackNavigationProp<AppStackParamList, 'EventOccurrence'>;

interface Props {
  eventId: string;
  occurrenceId: string;
  initialTab?: EventOccurrenceTab;
  navigation: Navigation;
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function CustomTabBar({ state, navigation }: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const onPress = () => {
          const pressed = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !pressed.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            key={route.key}
            onPress={onPress}
            style={[styles.tabButton, focused && styles.tabButtonActive]}
          >
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>
              {TAB_LABELS[route.name as EventOccurrenceTab]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Shell({ initialTab, navigation }: Pick<Props, 'initialTab' | 'navigation'>) {
  const { user } = useAuth();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { refreshBootstrap } = useEventSession();
  const {
    event, occurrence, banner, staleAt, unavailable, notFound, isLoading, isRefreshing, reload, canViewDashboard,
  } = useOccurrenceDashboard();

  const role = user?.userRole ?? null;
  const canScan = role ? hasPermission(role, Permission.EVENT_SCAN) : false;
  const isActive = occurrence?.status === OccurrenceStatus.ACTIVE;
  const canViewLog = canViewDashboard || canScan;

  const tabs = useMemo<EventOccurrenceTab[]>(() => {
    const result: EventOccurrenceTab[] = [];
    if (canViewDashboard) result.push('Progress');
    if (canScan && isActive) result.push('Scan');
    if (canViewLog) result.push('Log');
    return result;
  }, [canViewDashboard, canScan, isActive, canViewLog]);

  const initialRoute = initialTab && tabs.includes(initialTab) ? initialTab : tabs[0];

  const handleRefresh = () => {
    void refreshBootstrap().catch(() => undefined);
    void reload();
  };

  const header = (
    <EventScreenHeader
      title={event?.eventName ?? 'Event'}
      subtitle={occurrence ? `${occurrence.date} #${occurrence.seq}` : undefined}
      onBack={() => navigation.goBack()}
      right={(
        <>
          {occurrence ? <OccurrenceStatusBadge status={occurrence.status} /> : null}
          <TouchableOpacity
            accessibilityLabel="Refresh"
            accessibilityRole="button"
            disabled={isOffline || isRefreshing}
            onPress={handleRefresh}
            style={styles.headerButton}
          >
            {isRefreshing
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <MaterialIcons name="refresh" size={24} color={COLORS.white} />}
          </TouchableOpacity>
        </>
      )}
    />
  );

  if (notFound) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <MaterialIcons name="event-busy" size={48} color={COLORS.textSecondary} />
          <Text style={styles.centeredText}>{EVENT_DASHBOARD_MESSAGES.OCCURRENCE_GONE}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <OfflineBanner />
      {!tour?.tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
      {banner ? (
        <StatusBanner
          kind={banner.kind}
          message={banner.message}
          primaryAction={isOffline ? undefined : { label: 'Retry', onPress: () => void reload() }}
        />
      ) : null}
      {staleAt ? (
        <StatusBanner kind="warning" message={EVENT_DASHBOARD_MESSAGES.STALE.replace('{time}', formatDateTime(staleAt))} />
      ) : null}
      {unavailable ? <StatusBanner kind="info" message={unavailable} /> : null}

      {isLoading || !initialRoute ? (
        <View style={styles.centered}>
          {isLoading ? <ActivityIndicator color={COLORS.primary} /> : null}
        </View>
      ) : (
        <Tab.Navigator
          initialRouteName={initialRoute}
          tabBarPosition="bottom"
          tabBar={(props) => <CustomTabBar {...props} />}
          screenOptions={{ swipeEnabled: true, lazy: false }}
        >
          {tabs.includes('Progress') ? <Tab.Screen name="Progress" component={EventProgressTab} /> : null}
          {tabs.includes('Scan') ? <Tab.Screen name="Scan" component={EventScanTab} /> : null}
          {tabs.includes('Log') ? <Tab.Screen name="Log" component={EventActivityLogTab} /> : null}
        </Tab.Navigator>
      )}
    </View>
  );
}

export default function EventOccurrenceTabNavigator({ eventId, occurrenceId, initialTab, navigation }: Props) {
  const { tour } = useTour();
  return (
    <OccurrenceDashboardProvider tourId={tour?.tourId} eventId={eventId} occurrenceId={occurrenceId}>
      <Shell initialTab={initialTab} navigation={navigation} />
    </OccurrenceDashboardProvider>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 15, fontWeight: '600' },
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopColor: COLORS.border,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  tabButton: { alignItems: 'center', flex: 1, paddingVertical: 10 },
  tabButtonActive: { borderBottomColor: COLORS.primary, borderBottomWidth: 2 },
  tabLabel: { color: COLORS.textSecondary, fontSize: 12 },
  tabLabelActive: { color: COLORS.primary, fontWeight: '600' },
});
