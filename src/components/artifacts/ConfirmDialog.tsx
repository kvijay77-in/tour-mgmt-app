import React from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../../constants/colors';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isSubmitting?: boolean;
  confirmTone?: 'danger' | 'primary';
  /** Extra content (e.g. an optional reason input) shown below the message. */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isSubmitting = false,
  confirmTone = 'danger',
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      accessibilityViewIsModal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <View accessibilityRole="alert" style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {children}
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={onCancel}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={onConfirm}
              style={[
                styles.confirmButton,
                confirmTone === 'primary' && styles.confirmButtonPrimary,
                isSubmitting && styles.disabledButton,
              ]}
            >
              {isSubmitting ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    maxWidth: 440,
    padding: 24,
    width: '100%',
  },
  title: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700' },
  message: { color: COLORS.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 10 },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 24 },
  cancelButton: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  confirmButton: { alignItems: 'center', backgroundColor: COLORS.danger, borderRadius: 6, justifyContent: 'center', minWidth: 82, paddingHorizontal: 16, paddingVertical: 10 },
  confirmButtonPrimary: { backgroundColor: COLORS.primary },
  disabledButton: { opacity: 0.7 },
  confirmText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
});