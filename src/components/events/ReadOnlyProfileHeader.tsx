import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';

export interface ReadOnlyProfileHeaderProps {
  riderId: string;
  name: string;
  photoUrl?: string | null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Read-only rider identity strip; profile fields are never editable here. */
export default function ReadOnlyProfileHeader({ riderId, name, photoUrl }: ReadOnlyProfileHeaderProps) {
  return (
    <View accessible accessibilityLabel={`Rider ${name}, ${riderId}`} style={styles.container}>
      {photoUrl ? (
        <Image accessibilityIgnoresInvertColors source={{ uri: photoUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.initials]}>
          <Text style={styles.initialsText}>{initialsOf(name)}</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.meta}>{riderId}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 12,
  },
  avatar: { borderRadius: 24, height: 48, width: 48 },
  initials: { alignItems: 'center', backgroundColor: COLORS.gray[200], justifyContent: 'center' },
  initialsText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  body: { flex: 1, minWidth: 0 },
  name: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { color: COLORS.textSecondary, fontSize: 13, marginTop: 2 },
});
