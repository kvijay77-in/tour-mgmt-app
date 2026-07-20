/**
 * App Navigator — authenticated stack.
 *
 * Phase 1 adds CheckIn + admin screens as stack routes (Modal→stack
 * migration). Admin routes are registered conditionally on isAdministrator.
 * ChangePassword remains a Dashboard modal until Phase 2.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 1).
 */

import React from 'react';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../types/navigation';
import { useAuth } from '../context/AuthContext';
import { useTour } from '../context/TourContext';
import { UserRole } from '../types/models';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import CheckInScreen from '../screens/checkin/CheckInScreen';
import RideStatusManagementScreen from '../screens/admin/RideStatusManagementScreen';
import UserOnboardingScreen from '../screens/admin/UserOnboardingScreen';
import UserEnableDisableScreen from '../screens/admin/UserEnableDisableScreen';
import UserDeleteScreen from '../screens/admin/UserDeleteScreen';
import UserModifyScreen from '../screens/admin/UserModifyScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

function CheckInRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'CheckIn'>) {
  return (
    <CheckInScreen
      ride={route.params.ride}
      managedPitStopStageNumber={route.params.managedPitStopStageNumber}
      onCheckInComplete={() => {}}
      onClose={() => navigation.goBack()}
    />
  );
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
  return <UserOnboardingScreen onClose={() => navigation.goBack()} />;
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

export default function AppNavigator() {
  const { user } = useAuth();
  const isAdministrator = user?.userRole === UserRole.ADMINISTRATOR;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
      <Stack.Screen
        name="CheckIn"
        component={CheckInRoute}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
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
    </Stack.Navigator>
  );
}
