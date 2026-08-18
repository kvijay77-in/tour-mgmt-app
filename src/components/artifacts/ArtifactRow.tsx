import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { ArtifactManifestItem } from '../../types/api';

export type ArtifactRowStatus = 'idle' | 'uploading' | 'error';

export interface ArtifactRowProps {
  artifactId: string;
  title: string;
  category: 'tour' | 'ride';
  artifact?: ArtifactManifestItem;
  status?: ArtifactRowStatus;
  errorMessage?: string;
  isDesktop: boolean;
  onUpload: () => void;
  onDelete: () => void;
  onPreview?: () => void;
}

function formatFileSize(sizeBytes?: number): string {
  if (!sizeBytes || sizeBytes < 1) return '—';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ActionButton({
  accessibilityLabel,
  icon,
  label,
  onPress,
  disabled = false,
}: {
  accessibilityLabel: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    >
      <MaterialIcons name={icon} size={16} color={disabled ? COLORS.textDisabled : COLORS.primary} />
      <Text style={[styles.actionText, disabled && styles.disabledText]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ArtifactActions({
  artifact,
  isUploading,
  onUpload,
  onDelete,
  onPreview,
}: Pick<ArtifactRowProps, 'artifact' | 'onUpload' | 'onDelete' | 'onPreview'> & { isUploading: boolean }) {
  return (
    <View style={styles.actions}>
      {artifact?.downloadUrl && onPreview ? (
        <ActionButton
          accessibilityLabel={`Open ${artifact?.title || 'artifact'} preview`}
          icon="open-in-new"
          label="Open"
          onPress={onPreview}
          disabled={isUploading}
        />
      ) : null}
      <ActionButton
        accessibilityLabel={`${artifact ? 'Replace' : 'Upload'} ${artifact?.title || 'artifact'}`}
        icon={artifact ? 'refresh' : 'upload'}
        label={artifact ? 'Replace' : 'Upload'}
        onPress={onUpload}
        disabled={isUploading}
      />
      {artifact ? (
        <ActionButton
          accessibilityLabel={`Delete ${artifact.title || 'artifact'}`}
          icon="delete-outline"
          label="Delete"
          onPress={onDelete}
          disabled={isUploading}
        />
      ) : null}
    </View>
  );
}

export default function ArtifactRow({
  artifactId,
  title,
  category,
  artifact,
  status = 'idle',
  errorMessage,
  isDesktop,
  onUpload,
  onDelete,
  onPreview,
}: ArtifactRowProps) {
  const isUploading = status === 'uploading';
  const displayTitle = title || artifact?.title || artifactId;

  if (!isDesktop) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.titleWrap}>
            <Text style={styles.title}>{displayTitle}</Text>
            <Text style={styles.artifactId}>{artifactId} · {category}</Text>
          </View>
          {isUploading ? <ActivityIndicator color={COLORS.primary} /> : null}
        </View>
        <View style={styles.details}>
          <Text style={styles.detail}>Version: {artifact ? artifact.version : 'Not uploaded'}</Text>
          <Text style={styles.detail}>Size: {formatFileSize(artifact?.sizeBytes)}</Text>
          <Text style={styles.detail}>Uploaded: {formatUploadedAt(artifact?.uploadedAt)}</Text>
        </View>
        <ArtifactActions
          artifact={artifact}
          isUploading={isUploading}
          onUpload={onUpload}
          onDelete={onDelete}
          onPreview={onPreview}
        />
        {status === 'error' && errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.tableRow}>
      <Text style={[styles.cell, styles.typeCell]}>{artifactId}</Text>
      <Text style={[styles.cell, styles.titleCell]}>{displayTitle}</Text>
      <Text style={[styles.cell, styles.versionCell]}>{artifact ? artifact.version : 'Not uploaded'}</Text>
      <Text style={[styles.cell, styles.sizeCell]}>{formatFileSize(artifact?.sizeBytes)}</Text>
      <Text style={[styles.cell, styles.dateCell]}>{formatUploadedAt(artifact?.uploadedAt)}</Text>
      <View style={[styles.cell, styles.actionsCell]}>
        {isUploading ? <ActivityIndicator color={COLORS.primary} /> : null}
        <ArtifactActions
          artifact={artifact}
          isUploading={isUploading}
          onUpload={onUpload}
          onDelete={onDelete}
          onPreview={onPreview}
        />
        {status === 'error' && errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      </View>
    </View>
  );
}

export { formatFileSize, formatUploadedAt };

const styles = StyleSheet.create({
  tableRow: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: 12,
  },
  cell: {
    color: COLORS.textPrimary,
    paddingHorizontal: 8,
  },
  typeCell: { flex: 1.25 },
  titleCell: { flex: 1.5, fontWeight: '600' },
  versionCell: { flex: 0.8 },
  sizeCell: { flex: 0.9 },
  dateCell: { flex: 1.4 },
  actionsCell: { flex: 2.2 },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 16,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  titleWrap: { flex: 1 },
  title: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  artifactId: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  details: { gap: 6, marginTop: 14 },
  detail: { color: COLORS.textSecondary, fontSize: 13 },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionButton: { alignItems: 'center', flexDirection: 'row', gap: 4, paddingVertical: 6 },
  actionButtonDisabled: { opacity: 0.65 },
  actionText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  disabledText: { color: COLORS.textDisabled },
  error: { color: COLORS.danger, flexShrink: 1, fontSize: 12, marginTop: 6 },
});