import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createMaterialTopTabNavigator, MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../screens/dashboard/DashboardScreen';
import CheckInScreen from '../screens/checkin/CheckInScreen';
import CheckInLogScreen from '../screens/checkin/CheckInLogScreen';
import { MainTabParamList } from '../types/navigation';
import { useRideSession } from '../context/RideSessionContext';

const Tab = createMaterialTopTabNavigator<MainTabParamList>();

function CustomTabBar(props: MaterialTopTabBarProps<MainTabParamList>) {
  const { state, navigation } = props;
  const insets = useSafeAreaInsets();
  const { isHistorical } = useRideSession();

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index: number) => {
        const label = route.name;
        const focused = state.index === index;
        const onPress = () => {
          if (route.name === 'CheckIn' && isHistorical) return;
          const event = navigation.emit({ type: 'tabPress', target: route.key });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            onPress={onPress}
            style={[styles.tabButton, focused && styles.tabButtonActive, route.name === 'CheckIn' && isHistorical && styles.tabButtonDisabled]}
          >
            <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function MainTabNavigator() {
  return (
    <Tab.Navigator tabBarPosition="bottom" tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ swipeEnabled: true }}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="CheckIn" component={CheckInScreen} />
      <Tab.Screen name="Log" component={CheckInLogScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#007AFF',
  },
  tabButtonDisabled: {
    opacity: 0.4,
  },
  tabLabel: {
    fontSize: 12,
    color: '#444',
  },
  tabLabelActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
});
