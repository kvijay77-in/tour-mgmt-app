import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';

export interface EventScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backIcon?: 'arrow-back' | 'home';
  right?: React.ReactNode;
}

export default function EventScreenHeader({
  title,
  subtitle,
  onBack,
  backIcon = 'arrow-back',
  right,
}: EventScreenHeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      {onBack ? (
        <TouchableOpacity
          accessibilityLabel={backIcon === 'home' ? 'Go to Home' : 'Go back'}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={styles.backButton}
        >
          <MaterialIcons name={backIcon} size={24} color={COLORS.white} />
        </TouchableOpacity>
      ) : null}
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  backButton: { padding: 4 },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { color: COLORS.white, fontSize: 20, fontWeight: '700' },
  subtitle: { color: COLORS.white, fontSize: 13, marginTop: 2, opacity: 0.85 },
});
