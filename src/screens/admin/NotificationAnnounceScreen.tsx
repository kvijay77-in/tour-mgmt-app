import React, { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { createNotification, describeUnexpectedNotificationError } from '../../services/api/notificationApi';

interface NotificationAnnounceScreenProps {
  onClose: () => void;
}

type AudiencePreset =
  | 'ALL_USERS'
  | 'ALL_RIDERS'
  | 'ALL_STAFF'
  | 'TOUR_RIDERS'
  | 'TOUR_STAFF'
  | 'STAFF_GROUP'
  | 'RIDERS_BY_STATUS'
  | 'SINGLE_RIDER'
  | 'SINGLE_USER';

function buildAudiences(preset: AudiencePreset, params: {
  tourId: string;
  group: string;
  status: string;
  riderId: string;
  userSub: string;
}): string[] {
  switch (preset) {
    case 'ALL_USERS':
      return ['ALL'];
    case 'ALL_RIDERS':
      return ['APP#RIDER'];
    case 'ALL_STAFF':
      return ['APP#MGMT'];
    case 'TOUR_RIDERS':
      return params.tourId ? [`TOUR#${params.tourId}#APP#RIDER`] : [];
    case 'TOUR_STAFF':
      return params.tourId ? [`TOUR#${params.tourId}#APP#MGMT`] : [];
    case 'STAFF_GROUP':
      return params.group ? [`GROUP#${params.group}`] : [];
    case 'RIDERS_BY_STATUS':
      return params.tourId && params.status ? [`TOUR#${params.tourId}#STATUS#${params.status}`] : [];
    case 'SINGLE_RIDER':
      return params.tourId && params.riderId ? [`TOUR#${params.tourId}#RIDER#${params.riderId}`] : [];
    case 'SINGLE_USER':
      return params.userSub ? [`USER#${params.userSub}`] : [];
    default:
      return [];
  }
}

export default function NotificationAnnounceScreen({ onClose }: NotificationAnnounceScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [ruleId, setRuleId] = useState('ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [preset, setPreset] = useState<AudiencePreset>('ALL_USERS');
  const [tourId, setTourId] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [riderId, setRiderId] = useState('');
  const [userSub, setUserSub] = useState('');
  const [push, setPush] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const audiences = useMemo(() => buildAudiences(preset, { tourId, group, status, riderId, userSub }), [
    group,
    preset,
    riderId,
    status,
    tourId,
    userSub,
  ]);

  const submit = async () => {
    if (!title.trim() || !message.trim()) {
      Alert.alert('Missing fields', 'Title and message are required.');
      return;
    }
    if (audiences.length === 0) {
      Alert.alert('Audience required', 'Please complete audience details for the selected preset.');
      return;
    }

    setIsSubmitting(true);
    try {
      const outcome = await createNotification({
        ruleId: ruleId.trim(),
        tourId: tourId.trim() || undefined,
        audiences,
        context: {
          title: title.trim(),
          message: message.trim(),
          push,
        },
      });
      if (outcome.kind === 'success') {
        Alert.alert('Announcement sent', `Notification ID: ${outcome.data.notificationId}`);
        setTitle('');
        setMessage('');
        return;
      }
      if (outcome.kind === 'unavailable') {
        Alert.alert('Notifications unavailable', 'Notification backend is not deployed yet.');
        return;
      }
      Alert.alert('Unable to send', outcome.error.message);
    } catch (error) {
      Alert.alert('Unable to send', describeUnexpectedNotificationError(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={onClose} accessibilityLabel="Close announce screen">
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Announce</Text>
        <TouchableOpacity style={[styles.sendButton, isSubmitting && styles.sendButtonDisabled]} onPress={() => void submit()} disabled={isSubmitting}>
          <Text style={styles.sendButtonText}>{isSubmitting ? 'Sending…' : 'Send'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.content, isDesktop && styles.contentDesktop]}>
        <Text style={styles.label}>Rule ID</Text>
        <TextInput value={ruleId} onChangeText={setRuleId} style={styles.input} placeholder="ANNOUNCEMENT" />

        <Text style={styles.label}>Title</Text>
        <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Title" />

        <Text style={styles.label}>Message</Text>
        <TextInput
          value={message}
          onChangeText={setMessage}
          style={[styles.input, styles.textArea]}
          multiline
          placeholder="Message"
        />

        <Text style={styles.label}>Audience preset</Text>
        <View style={styles.presetWrap}>
          {([
            ['ALL_USERS', 'All users'],
            ['ALL_RIDERS', 'All riders'],
            ['ALL_STAFF', 'All staff'],
            ['TOUR_RIDERS', 'Tour riders'],
            ['TOUR_STAFF', 'Tour staff'],
            ['STAFF_GROUP', 'Staff group'],
            ['RIDERS_BY_STATUS', 'Riders by tour status'],
            ['SINGLE_RIDER', 'Single rider'],
            ['SINGLE_USER', 'Single user'],
          ] as Array<[AudiencePreset, string]>).map(([value, label]) => (
            <TouchableOpacity
              key={value}
              style={[styles.presetChip, preset === value && styles.presetChipActive]}
              onPress={() => setPreset(value)}
            >
              <Text style={[styles.presetChipText, preset === value && styles.presetChipTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {(['TOUR_RIDERS', 'TOUR_STAFF', 'RIDERS_BY_STATUS', 'SINGLE_RIDER'] as AudiencePreset[]).includes(preset) && (
          <>
            <Text style={styles.label}>Tour ID</Text>
            <TextInput value={tourId} onChangeText={setTourId} style={styles.input} placeholder="TOT-2026" />
          </>
        )}

        {preset === 'STAFF_GROUP' && (
          <>
            <Text style={styles.label}>Group</Text>
            <TextInput value={group} onChangeText={setGroup} style={styles.input} placeholder="SUPER_USER" />
          </>
        )}

        {preset === 'RIDERS_BY_STATUS' && (
          <>
            <Text style={styles.label}>Status</Text>
            <TextInput value={status} onChangeText={setStatus} style={styles.input} placeholder="ACTIVE" />
          </>
        )}

        {preset === 'SINGLE_RIDER' && (
          <>
            <Text style={styles.label}>Rider ID</Text>
            <TextInput value={riderId} onChangeText={setRiderId} style={styles.input} placeholder="R123" />
          </>
        )}

        {preset === 'SINGLE_USER' && (
          <>
            <Text style={styles.label}>User sub</Text>
            <TextInput value={userSub} onChangeText={setUserSub} style={styles.input} placeholder="Cognito sub" />
          </>
        )}

        <View style={styles.switchRow}>
          <Text style={styles.label}>Push</Text>
          <Switch value={push} onValueChange={setPush} />
        </View>

        <Text style={styles.previewLabel}>Audience expression(s)</Text>
        <Text style={styles.previewValue}>{audiences.join(', ') || '—'}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginLeft: 6,
  },
  sendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.textDisabled,
  },
  sendButtonText: {
    color: COLORS.white,
    fontWeight: '700',
    fontSize: 13,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  contentDesktop: {
    maxWidth: 780,
    alignSelf: 'center',
    width: '100%',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: COLORS.surface,
    color: COLORS.textPrimary,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  presetWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: COLORS.surface,
  },
  presetChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#EAF2FF',
  },
  presetChipText: {
    fontSize: 12,
    color: COLORS.textPrimary,
  },
  presetChipTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  switchRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewLabel: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  previewValue: {
    fontSize: 13,
    color: COLORS.textPrimary,
  },
});
