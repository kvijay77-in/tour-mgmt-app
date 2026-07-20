/**
 * App Navigator — authenticated stack.
 *
 * Phase 0 registers only the Dashboard route; DashboardScreen still hosts
 * check-in/admin/change-password as Modals. Later migration phases add
 * CheckIn, ChangePassword and admin routes here.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 0).
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppStackParamList } from '../types/navigation';
import DashboardScreen from '../screens/dashboard/DashboardScreen';

const Stack = createNativeStackNavigator<AppStackParamList>();

export default function AppNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Dashboard" component={DashboardScreen} />
    </Stack.Navigator>
  );
}
