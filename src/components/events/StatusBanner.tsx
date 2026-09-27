import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { STATUS_BANNER_COLORS } from '../../constants/colors';
import { EventMessageKind } from '../../constants/eventMessages';

export interface StatusBannerAction {
  label: string;
  onPress: () => void;
}

export interface StatusBannerProps {
  kind: EventMessageKind;
  message: string;
  title?: string;
  primaryAction?: StatusBannerAction;
  secondaryAction?: StatusBannerAction;
  onDismiss?: () => void;
}

const ICONS: Record<EventMessageKind, React.ComponentProps<typeof MaterialIcons>['name']> = {
  error: 'error-outline',
  warning: 'warning-amber',
  info: 'info-outline',
};

export default function StatusBanner({
  kind,
  message,
  title,
  primaryAction,
  secondaryAction,
  onDismiss,
}: StatusBannerProps) {
  const iconColor = STATUS_BANNER_COLORS[kind].text;
  const textStyle = kindStyles[`${kind}Text`];

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={kind === 'error' ? 'alert' : undefined}
      style={[styles.container, kindStyles[kind]]}
    >
      <View style={styles.row}>
        <MaterialIcons name={ICONS[kind]} size={20} color={iconColor} />
        <View style={styles.body}>
          {title ? <Text style={[styles.title, textStyle]}>{title}</Text> : null}
          <Text style={[styles.message, textStyle]}>{message}</Text>
        </View>
        {onDismiss ? (
          <TouchableOpacity
            accessibilityLabel="Dismiss message"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDismiss}
          >
            <MaterialIcons name="close" size={18} color={iconColor} />
          </TouchableOpacity>
        ) : null}
      </View>
      {primaryAction || secondaryAction ? (
        <View style={styles.actions}>
          {secondaryAction ? (
            <TouchableOpacity accessibilityRole="button" onPress={secondaryAction.onPress} style={styles.action}>
              <Text style={[styles.actionText, textStyle]}>{secondaryAction.label}</Text>
            </TouchableOpacity>
          ) : null}
          {primaryAction ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={primaryAction.onPress}
              style={[styles.action, styles.primaryAction, kindStyles[`${kind}Border`]]}
            >
              <Text style={[styles.actionText, textStyle]}>{primaryAction.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 8, borderWidth: 1, marginBottom: 12, padding: 12 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  message: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 10 },
  action: { borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  primaryAction: { borderWidth: 1 },
  actionText: { fontSize: 14, fontWeight: '600' },
});

const kindStyles = StyleSheet.create({
  error: { backgroundColor: STATUS_BANNER_COLORS.error.background, borderColor: STATUS_BANNER_COLORS.error.border },
  warning: { backgroundColor: STATUS_BANNER_COLORS.warning.background, borderColor: STATUS_BANNER_COLORS.warning.border },
  info: { backgroundColor: STATUS_BANNER_COLORS.info.background, borderColor: STATUS_BANNER_COLORS.info.border },
  errorText: { color: STATUS_BANNER_COLORS.error.text },
  warningText: { color: STATUS_BANNER_COLORS.warning.text },
  infoText: { color: STATUS_BANNER_COLORS.info.text },
  errorBorder: { borderColor: STATUS_BANNER_COLORS.error.text },
  warningBorder: { borderColor: STATUS_BANNER_COLORS.warning.text },
  infoBorder: { borderColor: STATUS_BANNER_COLORS.info.text },
});
