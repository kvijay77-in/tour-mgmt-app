/**
 * App Navigator — authenticated stack.
 *
 * Phase 1 added CheckIn + admin screens as stack routes (Modal→stack
 * migration). Admin routes are registered conditionally on isAdministrator.
 * Phase 2 adds ChangePassword as a stack route.
 *
 * Event engine Phase 2: Home hub is the initial route; on web at widths
 * ≥ DESKTOP_MIN_WIDTH the stack is rendered beside a persistent SideNav.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 1, Phase 2).
 */

import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../types/navigation';
import { useAuth } from '../context/AuthContext';
import { useTour } from '../context/TourContext';
import { UserRole } from '../types/models';
import { DESKTOP_MIN_WIDTH } from '../constants/layout';
import HomeScreen from '../screens/home/HomeScreen';
import SideNav from '../components/common/SideNav';
import { useVisibleModules } from './modules';
import RideInfoScreen from '../screens/dashboard/RideInfoScreen';
import MainTabNavigator from './MainTabNavigator';
import { RideSessionProvider } from '../context/RideSessionContext';
import ChangePasswordScreen from '../screens/auth/ChangePasswordScreen';
import SyncStatusScreen from '../screens/settings/SyncStatusScreen';
import AdvancedSettingsScreen from '../screens/settings/AdvancedSettingsScreen';
import ArtifactsScreen from '../screens/admin/ArtifactsScreen';
import RideStatusManagementScreen from '../screens/admin/RideStatusManagementScreen';
import UserOnboardingScreen from '../screens/admin/UserOnboardingScreen';
import UserEnableDisableScreen from '../screens/admin/UserEnableDisableScreen';
import UserDeleteScreen from '../screens/admin/UserDeleteScreen';
import UserModifyScreen from '../screens/admin/UserModifyScreen';
import TourManagementScreen from '../screens/admin/TourManagementScreen';
import EventsHomeScreen from '../screens/events/EventsHomeScreen';
import EventDefinitionListScreen from '../screens/events/EventDefinitionListScreen';
import EventDefinitionEditorScreen from '../screens/events/EventDefinitionEditorScreen';
import OccurrenceManagementScreen from '../screens/events/OccurrenceManagementScreen';
import EventScanScreen from '../screens/events/EventScanScreen';
import OccurrenceDashboardScreen from '../screens/events/OccurrenceDashboardScreen';
import BaggageReconciliationScreen from '../screens/events/BaggageReconciliationScreen';
import RiderProgressScreen from '../screens/events/RiderProgressScreen';
import HotelManagementScreen from '../screens/events/HotelManagementScreen';
import HotelAllocationUploadScreen from '../screens/events/HotelAllocationUploadScreen';
import HotelAllocationAdjustScreen from '../screens/events/HotelAllocationAdjustScreen';
import RiderExitScreen from '../screens/admin/RiderExitScreen';
import TourUserAssignmentScreen from '../screens/admin/TourUserAssignmentScreen';
import RiderProfileDefinitionsScreen from '../screens/admin/RiderProfileDefinitionsScreen';
import { EventSessionProvider } from '../context/EventSessionContext';
import { SyncStatusProvider } from '../context/SyncStatusContext';
import { Permission } from '../types/models';
import { canUseAdvancedSettings, hasPermission } from '../utils/permissions';

const Stack = createNativeStackNavigator<AppStackParamList>();

function RideInfoRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'RideInfo'>) {
  return <RideInfoScreen ride={route.params.ride} onClose={() => navigation.goBack()} />;
}

function ChangePasswordRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'ChangePassword'>) {
  return <ChangePasswordScreen onClose={() => navigation.goBack()} />;
}

function SyncStatusRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'SyncStatus'>) {
  return <SyncStatusScreen onClose={() => navigation.goBack()} />;
}

function AdvancedSettingsRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'AdvancedSettings'>) {
  return <AdvancedSettingsScreen onClose={() => navigation.goBack()} />;
}

function ArtifactsRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'Artifacts'>) {
  return <ArtifactsScreen onClose={() => navigation.goBack()} />;
}

function RideStatusManagementRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'RideStatusManagement'>) {
  const { tour } = useTour();
  if (!tour) return null;
  return (
    <RideStatusManagementScreen
      tourId={tour.tourId}
      onClose={() => navigation.goBack()}
    />
  );
}

function UserOnboardingRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'UserOnboarding'>) {
  const { user } = useAuth();
  const canAssign = user ? hasPermission(user.userRole, Permission.MANAGE_TOUR_USERS) : false;
  // replace (not navigate) so the assignment screen is not stacked on top of the modal
  return (
    <UserOnboardingScreen
      onClose={() => navigation.goBack()}
      onAssignToTour={canAssign ? (userId) => navigation.replace('TourUserAssignment', { userId }) : undefined}
    />
  );
}

function UserEnableDisableRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'UserEnableDisable'>) {
  return <UserEnableDisableScreen onClose={() => navigation.goBack()} />;
}

function UserDeleteRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'UserDelete'>) {
  return <UserDeleteScreen onClose={() => navigation.goBack()} />;
}

function UserModifyRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'UserModify'>) {
  return <UserModifyScreen onClose={() => navigation.goBack()} />;
}

function TourManagementRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'TourManagement'>) {
  return <TourManagementScreen readOnly={route.params.readOnly} onClose={() => navigation.goBack()} />;
}

function EventsHomeRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'EventsHome'>) {
  return <EventsHomeScreen navigation={navigation} />;
}

function EventDefinitionListRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'EventDefinitionList'>) {
  return <EventDefinitionListScreen navigation={navigation} />;
}

function EventDefinitionEditorRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'EventDefinitionEditor'>) {
  return <EventDefinitionEditorScreen eventId={route.params?.eventId} navigation={navigation} />;
}

function OccurrenceManagementRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'OccurrenceManagement'>) {
  return <OccurrenceManagementScreen eventId={route.params.eventId} navigation={navigation} />;
}

function EventScanRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'EventScan'>) {
  return (
    <EventScanScreen
      eventId={route.params.eventId}
      occurrenceId={route.params.occurrenceId}
      navigation={navigation}
    />
  );
}

function OccurrenceDashboardRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'OccurrenceDashboard'>) {
  return (
    <OccurrenceDashboardScreen
      eventId={route.params.eventId}
      occurrenceId={route.params.occurrenceId}
      navigation={navigation}
    />
  );
}

function BaggageReconciliationRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'BaggageReconciliation'>) {
  return (
    <BaggageReconciliationScreen
      eventId={route.params.eventId}
      occurrenceId={route.params.occurrenceId}
      navigation={navigation}
    />
  );
}

function RiderProgressRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'RiderProgress'>) {
  return (
    <RiderProgressScreen
      riderId={route.params.riderId}
      eventId={route.params.eventId}
      occurrenceId={route.params.occurrenceId}
      navigation={navigation}
    />
  );
}

function HotelManagementRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'HotelManagement'>) {
  return <HotelManagementScreen navigation={navigation} />;
}

function HotelAllocationUploadRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'HotelAllocationUpload'>) {
  return <HotelAllocationUploadScreen onClose={() => navigation.goBack()} />;
}

function HotelAllocationAdjustRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'HotelAllocationAdjust'>) {
  return (
    <HotelAllocationAdjustScreen
      riderId={route.params.riderId}
      stayDate={route.params.stayDate}
      navigation={navigation}
    />
  );
}

function RiderExitRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'RiderExit'>) {
  return <RiderExitScreen navigation={navigation} />;
}

function TourUserAssignmentRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'TourUserAssignment'>) {
  return <TourUserAssignmentScreen userId={route.params?.userId} navigation={navigation} />;
}

function RiderProfileDefinitionsRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'RiderProfileDefinitions'>) {
  return <RiderProfileDefinitionsScreen onClose={() => navigation.goBack()} />;
}

function AppStack() {
  const { user } = useAuth();
  const isAdministrator = user?.userRole === UserRole.ADMINISTRATOR;
  const canManageTours = isAdministrator || user?.userRole === UserRole.SUPER_USER;
  const can = (permission: Permission) => (user ? hasPermission(user.userRole, permission) : false);
  const canViewEvents = can(Permission.EVENT_SCAN)
    || can(Permission.VIEW_DASHBOARD)
    || can(Permission.MANAGE_EVENT_OCCURRENCES);

  return (
    <Stack.Navigator initialRouteName="Home" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="MainTabs">
        {() => (
          <RideSessionProvider>
            <MainTabNavigator />
          </RideSessionProvider>
        )}
      </Stack.Screen>
      <Stack.Screen
        name="RideInfo"
        component={RideInfoRoute}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordRoute}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="SyncStatus"
        component={SyncStatusRoute}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      {canUseAdvancedSettings(user?.userRole) && (
        <Stack.Screen
          name="AdvancedSettings"
          component={AdvancedSettingsRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}

      {isAdministrator && (
        <Stack.Screen
          name="Artifacts"
          component={ArtifactsRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      
      {isAdministrator && (
        <Stack.Screen
          name="RideStatusManagement"
          component={RideStatusManagementRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {isAdministrator && (
        <Stack.Screen
          name="UserOnboarding"
          component={UserOnboardingRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {isAdministrator && (
        <Stack.Screen
          name="UserEnableDisable"
          component={UserEnableDisableRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {isAdministrator && (
        <Stack.Screen
          name="UserDelete"
          component={UserDeleteRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {isAdministrator && (
        <Stack.Screen
          name="UserModify"
          component={UserModifyRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {canManageTours && (
        <Stack.Screen
          name="TourManagement"
          component={TourManagementRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {canViewEvents && <Stack.Screen name="EventsHome" component={EventsHomeRoute} />}
      {can(Permission.MANAGE_EVENTS) && (
        <Stack.Screen name="EventDefinitionList" component={EventDefinitionListRoute} />
      )}
      {can(Permission.MANAGE_EVENTS) && (
        <Stack.Screen name="EventDefinitionEditor" component={EventDefinitionEditorRoute} />
      )}
      {can(Permission.MANAGE_EVENT_OCCURRENCES) && (
        <Stack.Screen name="OccurrenceManagement" component={OccurrenceManagementRoute} />
      )}
      {can(Permission.EVENT_SCAN) && <Stack.Screen name="EventScan" component={EventScanRoute} />}
      {can(Permission.VIEW_DASHBOARD) && (
        <Stack.Screen name="OccurrenceDashboard" component={OccurrenceDashboardRoute} />
      )}
      {can(Permission.VIEW_DASHBOARD) && (
        <Stack.Screen name="BaggageReconciliation" component={BaggageReconciliationRoute} />
      )}
      <Stack.Screen name="RiderProgress" component={RiderProgressRoute} />
      {can(Permission.MANAGE_HOTEL_ALLOCATIONS) && (
        <Stack.Screen name="HotelManagement" component={HotelManagementRoute} />
      )}
      {can(Permission.MANAGE_HOTEL_ALLOCATIONS) && (
        <Stack.Screen
          name="HotelAllocationUpload"
          component={HotelAllocationUploadRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
      {can(Permission.MANAGE_HOTEL_ALLOCATIONS) && (
        <Stack.Screen name="HotelAllocationAdjust" component={HotelAllocationAdjustRoute} />
      )}
      {can(Permission.RIDER_EXIT) && <Stack.Screen name="RiderExit" component={RiderExitRoute} />}
      {can(Permission.MANAGE_TOUR_USERS) && (
        <Stack.Screen name="TourUserAssignment" component={TourUserAssignmentRoute} />
      )}
      {can(Permission.RIDER_PROFILE_DEFINITION_MANAGE) && (
        <Stack.Screen
          name="RiderProfileDefinitions"
          component={RiderProfileDefinitionsRoute}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
      )}
    </Stack.Navigator>
  );
}

export default function AppNavigator() {
  const { width } = useWindowDimensions();
  const { sections, hasHome } = useVisibleModules();
  const showSideNav = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH && hasHome;

  return (
    <SyncStatusProvider>
      <EventSessionProvider>
        <View style={styles.shell}>
          {showSideNav && <SideNav sections={sections} />}
          <View style={styles.content}>
            <AppStack />
          </View>
        </View>
      </EventSessionProvider>
    </SyncStatusProvider>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    flexDirection: 'row',
  },
  content: {
    flex: 1,
  },
});
