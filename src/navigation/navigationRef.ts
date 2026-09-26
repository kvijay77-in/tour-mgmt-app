/**
 * Navigation container ref, used by components rendered outside the app
 * stack (SideNav) to navigate and to track the focused stack route.
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import { AppStackParamList } from '../types/navigation';

export const navigationRef = createNavigationContainerRef<AppStackParamList>();
