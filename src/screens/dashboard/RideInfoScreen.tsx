import React from 'react';
import { View, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Ride } from '../../types/models';
import { RideInfoContent } from '../../components/dashboard/RideInfoContent';

interface RideInfoScreenProps {
  ride: Ride;
  onClose: () => void;
}

export default function RideInfoScreen({ ride, onClose }: RideInfoScreenProps) {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={{ width: Math.min(width * 0.92, 460), maxHeight: height * 0.9 }}
          activeOpacity={1}
          onPress={() => {
            // Prevent overlay tap-close while interacting with card content.
          }}
        >
          <RideInfoContent ride={ride} showCloseButton onClose={onClose} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
