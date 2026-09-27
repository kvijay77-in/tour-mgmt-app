import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../../constants/colors';
import { HOTEL_UPLOAD_MESSAGES } from '../../constants/eventMessages';
import { UploadErrorItem } from '../../types/api';

export interface RowErrorTableProps {
  errors: UploadErrorItem[];
  /** Total errors; errors[] may be capped by the backend. */
  errorCount: number;
}

/** Upload validation errors in server order; row 0 is the whole file, messages are verbatim. */
export default function RowErrorTable({ errors, errorCount }: RowErrorTableProps) {
  const isCapped = errors.length < errorCount;

  return (
    <View accessibilityLabel="Upload issues" style={styles.table}>
      <View style={[styles.row, styles.headerRow]}>
        <Text style={[styles.cellRow, styles.headerText]}>Row</Text>
        <Text style={[styles.cellCode, styles.headerText]}>Code</Text>
        <Text style={[styles.cellMessage, styles.headerText]}>Message</Text>
      </View>
      {errors.map((error, index) => (
        <View key={`${error.row}-${error.code}-${index}`} style={styles.row}>
          <Text style={[styles.cellRow, styles.cellText]}>{error.row === 0 ? 'File' : String(error.row)}</Text>
          <Text style={[styles.cellCode, styles.codeText]}>{error.code}</Text>
          <Text style={[styles.cellMessage, styles.cellText]}>{error.message}</Text>
        </View>
      ))}
      {isCapped ? (
        <Text style={styles.footer}>
          {HOTEL_UPLOAD_MESSAGES.CAPPED_FOOTER
            .replace('{shown}', String(errors.length))
            .replace('{total}', String(errorCount))}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerRow: { backgroundColor: COLORS.gray[100], borderTopWidth: 0 },
  headerText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  cellRow: { width: 44 },
  cellCode: { flexBasis: 150, flexShrink: 1 },
  cellMessage: { flex: 1 },
  cellText: { color: COLORS.textPrimary, fontSize: 13 },
  codeText: {
    color: COLORS.textSecondary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
  },
  footer: {
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
    padding: 10,
  },
});
