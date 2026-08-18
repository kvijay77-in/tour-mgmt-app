/**
 * App Navigator — authenticated stack.
 *
 * Phase 1 added CheckIn + admin screens as stack routes (Modal→stack
 * migration). Admin routes are registered conditionally on isAdministrator.
 * Phase 2 adds ChangePassword as a stack route.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 1, Phase 2).
 */

import React from 'react';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppStackParamList } from '../types/navigation';
import { useAuth } from '../context/AuthContext';
import { useTour } from '../context/TourContext';
import { UserRole } from '../types/models';
import RideInfoScreen from '../screens/dashboard/RideInfoScreen';
import MainTabNavigator from './MainTabNavigator';
import { RideSessionProvider } from '../context/RideSessionContext';
import ChangePasswordScreen from '../screens/auth/ChangePasswordScreen';
import ArtifactsScreen from '../screens/admin/ArtifactsScreen';
import RideStatusManagementScreen from '../screens/admin/RideStatusManagementScreen';
import UserOnboardingScreen from '../screens/admin/UserOnboardingScreen';
import UserEnableDisableScreen from '../screens/admin/UserEnableDisableScreen';
import UserDeleteScreen from '../screens/admin/UserDeleteScreen';
import UserModifyScreen from '../screens/admin/UserModifyScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

function RideInfoRoute({ route, navigation }: NativeStackScreenProps<AppStackParamList, 'RideInfo'>) {
  return <RideInfoScreen ride={route.params.ride} onClose={() => navigation.goBack()} />;
}

function ChangePasswordRoute({ navigation }: NativeStackScreenProps<AppStackParamList, 'ChangePassword'>) {
  return <ChangePasswordScreen onClose={() => navigation.goBack()} />;
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
    </Stack.Navigator>
  );
}
