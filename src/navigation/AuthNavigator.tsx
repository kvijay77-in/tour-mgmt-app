/**
 * Auth Navigator — Login / Forgot Password / New-Password-Required stack.
 *
 * Screens keep their existing prop-based API (onForgotPassword,
 * onNewPasswordRequired, etc.); these route wrappers adapt that API to
 * React Navigation's navigation/route objects.
 *
 * See /memories/repo/spa-to-multiscreen-migration-plan.md (Phase 0).
 */

import React from 'react';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../types/navigation';
import LoginScreen from '../screens/auth/LoginScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import NewPasswordScreen from '../screens/auth/NewPasswordScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

function LoginRoute({ route, navigation }: NativeStackScreenProps<AuthStackParamList, 'Login'>) {
  return (
    <LoginScreen
      initialUsername={route.params?.prefillUsername}
      externalErrorMessage={route.params?.externalError ?? null}
      onForgotPassword={({ username }) => navigation.navigate('ForgotPassword', { username })}
      onNewPasswordRequired={({ username, rememberMe }) =>
        navigation.navigate('NewPassword', { username, rememberMe })}
    />
  );
}

function ForgotPasswordRoute({ route, navigation }: NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>) {
  return (
    <ForgotPasswordScreen
      initialUsername={route.params?.username}
      onBackToLogin={() => navigation.navigate('Login', {})}
      onPasswordResetComplete={({ username }) =>
        navigation.navigate('Login', { prefillUsername: username })}
    />
  );
}

function NewPasswordRoute({ route, navigation }: NativeStackScreenProps<AuthStackParamList, 'NewPassword'>) {
  return (
    <NewPasswordScreen
      username={route.params.username}
      rememberMe={route.params.rememberMe}
      onCancel={() => navigation.navigate('Login', {})}
      onPasswordChangedNoRole={() =>
        navigation.navigate('Login', {
          externalError: 'No role has been assigned to your account. Please contact your tour administrator.',
        })}
    />
  );
}

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginRoute} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordRoute} />
      <Stack.Screen name="NewPassword" component={NewPasswordRoute} />
    </Stack.Navigator>
  );
}
