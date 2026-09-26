/**
 * Rider exit, exit cancellation and retained-baggage release (RIDER_EXIT,
 * online-only). Exit requires a baggage disposition (RETAINED | WITH_RIDER)
 * and takes an optional note; release is offered only for RETAINED baggage.
 * Baggage status starts from the tour rider list, else the bootstrap cache,
 * and is replaced by the TourRider item each action returns (also written to
 * the local rider_baggage_status cache).
 *
 * See docs/Event-Engine-Design.md § RiderExitScreen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EventMessageKind, RIDER_EXIT_MESSAGES } from '../../constants/eventMessages';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError, EventApiOutcome } from '../../services/api/eventsApi';
import { cancelRiderExit, exitRider, listRiders, releaseRiderBaggage } from '../../services/api/riderApi';
import { getRiderBaggageStatus, upsertRiderBaggageStatus } from '../../services/database/eventStore';
import { BaggageDisposition, BaggageStatus, RiderBaggageStatus, TourRider, TourRiderStatus } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { logger } from '../../utils/logger';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import ReadOnlyProfileHeader from '../../components/events/ReadOnlyProfileHeader';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'RiderExitScreen';
const MAX_RESULTS = 10;
const RELOAD_CODES = new Set(['RIDER_ALREADY_EXITED', 'INVALID_EXIT_CANCEL_INVOCATION', 'BAGGAGE_NOT_RETAINED']);

interface RiderExitScreenProps {
  navigation: NativeStackNavigationProp<AppStackParamList, 'RiderExit'>;
}

type Banner = { kind: EventMessageKind; message: string };

type RiderState = Pick<Partial<TourRider>,
  'prevStatus' | 'exitedAt' | 'baggageExitNote' | 'baggageExitedAt' | 'baggageReleasedAt'
> & {
  riderId: string;
  status?: string;
  baggageStatus?: BaggageStatus;
};

const DISPOSITIONS: Array<{ value: BaggageDisposition; label: string }> = [
  { value: BaggageStatus.RETAINED, label: 'Baggage retained by organisers' },
  { value: BaggageStatus.WITH_RIDER, label: 'Rider is taking baggage now' },
];

const BAGGAGE_LABELS: Record<BaggageStatus, string> = {
  [BaggageStatus.ACTIVE]: 'With the tour',
  [BaggageStatus.RETAINED]: 'Retained by organisers',
  [BaggageStatus.WITH_RIDER]: 'Released to rider',
};

function toRiderState(item: Partial<TourRider> & { riderId: string; status?: string }): RiderState {
  return {
    riderId: item.riderId,
    status: item.status,
    prevStatus: item.prevStatus,
    exitedAt: item.exitedAt,
    baggageStatus: item.baggageStatus,
    baggageExitNote: item.baggageExitNote,
    baggageExitedAt: item.baggageExitedAt,
    baggageReleasedAt: item.baggageReleasedAt,
  };
}

function formatTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function RiderExitScreen({ navigation }: RiderExitScreenProps) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { riderNamesById, getRiderDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [riders, setRiders] = useState<Record<string, RiderState>>({});
  const [ridersLoaded, setRidersLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [cachedBaggage, setCachedBaggage] = useState<RiderBaggageStatus | null>(null);
  const [disposition, setDisposition] = useState<BaggageDisposition | null>(null);
  const [exitNote, setExitNote] = useState('');
  const [dispositionError, setDispositionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'cancelExit' | 'release' | null>(null);
  const [releaseNote, setReleaseNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);

  const loadRiders = useCallback(async () => {
    if (!tourId || isOffline) return;
    setIsLoading(true);
    try {
      const list = await listRiders(tourId);
      setRiders(Object.fromEntries(list.map((item) => [
        item.riderId,
        toRiderState(item as Partial<TourRider> & { riderId: string; status?: string }),
      ])));
      setRidersLoaded(true);
    } catch (err) {
      logger.error(TAG, 'Loading tour riders failed', err);
      setRidersLoaded(false);
      setBanner({ kind: 'warning', message: RIDER_EXIT_MESSAGES.STATUS_UNAVAILABLE });
    } finally {
      setIsLoading(false);
    }
  }, [isOffline, tourId]);

  useEffect(() => {
    void loadRiders();
  }, [loadRiders]);

  useEffect(() => {
    setCachedBaggage(null);
    if (!selectedRiderId) return;
    let active = true;
    getRiderBaggageStatus(selectedRiderId)
      .then((status) => {
        if (active) setCachedBaggage(status);
      })
      .catch((err) => logger.warn(TAG, 'Reading cached baggage status failed', err));
    return () => {
      active = false;
    };
  }, [selectedRiderId]);

  const results = useMemo(() => {
    const text = query.trim().toUpperCase();
    if (!text) return [];
    const ids = new Set([...Object.keys(riderNamesById), ...Object.keys(riders)]);
    return [...ids]
      .filter((id) => id.toUpperCase().includes(text) || (riderNamesById[id] ?? '').toUpperCase().includes(text))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, MAX_RESULTS);
  }, [query, riderNamesById, riders]);

  const selected = selectedRiderId ? riders[selectedRiderId] ?? null : null;
  const riderName = selectedRiderId ? getRiderDisplayName(selectedRiderId).name : '';
  const baggageStatus = selected?.baggageStatus ?? cachedBaggage?.baggageStatus;
  const isExited = selected?.status === TourRiderStatus.EXITED;
  const canRelease = baggageStatus === BaggageStatus.RETAINED;
  const disabled = isOffline || isSubmitting || !tourId;
  const notInTour = Boolean(selectedRiderId && ridersLoaded && !selected);

  const selectRider = (riderId: string) => {
    setSelectedRiderId(riderId);
    setQuery('');
    setDisposition(null);
    setExitNote('');
    setDispositionError(null);
    setBanner(null);
  };

  const applyResult = async (item: TourRider, message: string) => {
    setRiders((current) => ({ ...current, [item.riderId]: toRiderState(item) }));
    setBanner({ kind: 'info', message: message.replace('{rider}', `${getRiderDisplayName(item.riderId).name} (${item.riderId})`) });
    if (item.baggageStatus) {
      const status: RiderBaggageStatus = {
        riderId: item.riderId,
        baggageStatus: item.baggageStatus,
        baggageReleasedAt: item.baggageReleasedAt ?? null,
      };
      setCachedBaggage(status);
      try {
        await upsertRiderBaggageStatus(status);
      } catch (err) {
        logger.warn(TAG, 'Caching baggage status failed', err);
      }
    }
  };

  const submit = async (
    send: () => Promise<EventApiOutcome<TourRider>>,
    successMessage: string,
    onExpectedError?: (code: string, message: string) => boolean,
  ): Promise<boolean> => {
    setIsSubmitting(true);
    setBanner(null);
    try {
      const outcome = await send();
      if (outcome.kind === 'error') {
        if (!onExpectedError?.(outcome.error.code, outcome.error.message)) {
          setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        }
        if (RELOAD_CODES.has(outcome.error.code)) void loadRiders();
        return false;
      }
      await applyResult(outcome.data, successMessage);
      return true;
    } catch (err) {
      logger.error(TAG, 'Rider exit action failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmExit = async () => {
    if (!tourId || !selectedRiderId) return;
    if (!disposition) {
      setDispositionError(RIDER_EXIT_MESSAGES.DISPOSITION_REQUIRED);
      return;
    }
    setDispositionError(null);
    const note = exitNote.trim();
    const ok = await submit(
      () => exitRider(tourId, selectedRiderId, { baggageDisposition: disposition, ...(note ? { note } : {}) }),
      RIDER_EXIT_MESSAGES.EXITED,
      (code, message) => {
        if (code !== 'BAGGAGE_DISPOSITION_REQUIRED') return false;
        setDispositionError(message);
        return true;
      },
    );
    if (ok) {
      setDisposition(null);
      setExitNote('');
    }
  };

  const confirmCancelExit = async () => {
    if (!tourId || !selectedRiderId) return;
    await submit(() => cancelRiderExit(tourId, selectedRiderId), RIDER_EXIT_MESSAGES.EXIT_CANCELLED);
    setDialog(null);
  };

  const confirmRelease = async () => {
    if (!tourId || !selectedRiderId) return;
    const note = releaseNote.trim();
    const ok = await submit(
      () => releaseRiderBaggage(tourId, selectedRiderId, note ? { note } : {}),
      RIDER_EXIT_MESSAGES.RELEASED,
    );
    setDialog(null);
    if (ok) setReleaseNote('');
  };

  const renderDetail = (label: string, value?: string | null) => (value ? (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  ) : null);

  return (
    <View style={styles.container}>
      <EventScreenHeader title="Rider exit" subtitle={tour?.name} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isOffline ? <StatusBanner kind="warning" message={RIDER_EXIT_MESSAGES.OFFLINE} /> : null}
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} /> : null}

        <View style={styles.panel}>
          <Text style={styles.label}>Find rider</Text>
          <TextInput
            accessibilityLabel="Search rider by ID or name"
            autoCapitalize="characters"
            editable={!isSubmitting}
            onChangeText={setQuery}
            placeholder="Search by rider ID or name"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.input}
            value={query}
          />
          {isLoading ? <ActivityIndicator color={COLORS.primary} size="small" style={styles.inlineLoader} /> : null}
          {results.map((id) => (
            <TouchableOpacity
              accessibilityLabel={`Select ${riderNamesById[id] ?? id} ${id}`}
              accessibilityRole="button"
              key={id}
              onPress={() => selectRider(id)}
              style={styles.resultRow}
            >
              <MaterialIcons name="person" size={18} color={COLORS.primary} />
              <Text style={styles.resultText}>{riderNamesById[id] ?? 'Unknown'} · {id}</Text>
              {riders[id]?.status ? <Text style={styles.resultMeta}>{riders[id].status}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>

        {selectedRiderId ? (
          <>
            <ReadOnlyProfileHeader riderId={selectedRiderId} name={riderName} />
            {notInTour ? (
              <StatusBanner kind="warning" message={RIDER_EXIT_MESSAGES.RIDER_NOT_IN_TOUR.replace('{riderId}', selectedRiderId)} />
            ) : null}

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Status</Text>
              {renderDetail('Tour status', selected?.status ?? (ridersLoaded ? null : 'Unknown'))}
              {renderDetail('Baggage', baggageStatus ? BAGGAGE_LABELS[baggageStatus] : 'Not recorded')}
              {renderDetail('Status before exit', isExited ? selected?.prevStatus : null)}
              {renderDetail('Exited at', formatTimestamp(selected?.exitedAt))}
              {renderDetail('Baggage note', selected?.baggageExitNote)}
              {renderDetail('Baggage released at', formatTimestamp(selected?.baggageReleasedAt ?? cachedBaggage?.baggageReleasedAt))}
            </View>

            {!isExited ? (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Exit rider</Text>
                <Text style={styles.label}>Baggage *</Text>
                {DISPOSITIONS.map((option) => {
                  const isSelected = disposition === option.value;
                  return (
                    <TouchableOpacity
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected, disabled }}
                      disabled={disabled}
                      key={option.value}
                      onPress={() => {
                        setDisposition(option.value);
                        setDispositionError(null);
                      }}
                      style={[styles.radioRow, isSelected && styles.radioRowSelected]}
                    >
                      <MaterialIcons
                        name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                        size={20}
                        color={isSelected ? COLORS.primary : COLORS.textSecondary}
                      />
                      <Text style={styles.radioText}>{option.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                {dispositionError ? <Text style={styles.errorText}>{dispositionError}</Text> : null}
                <Text style={[styles.label, styles.spaced]}>Note (optional)</Text>
                <TextInput
                  accessibilityLabel="Exit note"
                  editable={!disabled}
                  multiline
                  onChangeText={setExitNote}
                  placeholder="e.g. Bag kept in support vehicle"
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, styles.multiline]}
                  value={exitNote}
                />
                <View style={styles.actions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ disabled: disabled || !disposition }}
                    disabled={disabled || !disposition}
                    onPress={() => void confirmExit()}
                    style={[styles.dangerButton, (disabled || !disposition) && styles.disabled]}
                  >
                    {isSubmitting ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.buttonText}>Confirm exit</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Cancel exit</Text>
                <Text style={styles.hint}>Restores the previous tour status and resets the baggage status.</Text>
                <View style={styles.actions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={disabled}
                    onPress={() => setDialog('cancelExit')}
                    style={[styles.primaryButton, disabled && styles.disabled]}
                  >
                    <Text style={styles.buttonText}>Cancel exit</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Release retained baggage</Text>
              {!canRelease ? <Text style={styles.hint}>{RIDER_EXIT_MESSAGES.RELEASE_UNAVAILABLE}</Text> : null}
              <View style={styles.actions}>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ disabled: disabled || !canRelease }}
                  disabled={disabled || !canRelease}
                  onPress={() => setDialog('release')}
                  style={[styles.primaryButton, (disabled || !canRelease) && styles.disabled]}
                >
                  <Text style={styles.buttonText}>Release retained baggage</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={dialog === 'cancelExit'}
        title="Cancel exit?"
        message={`${riderName} (${selectedRiderId ?? ''}) returns to the previous tour status.`}
        confirmLabel="Cancel exit"
        cancelLabel="Keep exit"
        confirmTone="primary"
        isSubmitting={isSubmitting}
        onConfirm={() => void confirmCancelExit()}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        visible={dialog === 'release'}
        title="Release retained baggage?"
        message={`Baggage for ${riderName} (${selectedRiderId ?? ''}) is handed back and is no longer carried by the tour.`}
        confirmLabel="Release"
        confirmTone="primary"
        isSubmitting={isSubmitting}
        onConfirm={() => void confirmRelease()}
        onCancel={() => setDialog(null)}
      >
        <TextInput
          accessibilityLabel="Release note"
          editable={!isSubmitting}
          multiline
          onChangeText={setReleaseNote}
          placeholder="Note (optional)"
          placeholderTextColor={COLORS.textDisabled}
          style={[styles.input, styles.multiline, styles.dialogInput]}
          value={releaseNote}
        />
      </ConfirmDialog>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: { alignSelf: 'center', gap: 12, maxWidth: 760, padding: 16, paddingBottom: 32, width: '100%' },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  panelTitle: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  spaced: { marginTop: 10 },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 6,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  dialogInput: { marginTop: 12 },
  inlineLoader: { alignSelf: 'flex-start', marginVertical: 6 },
  resultRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
  },
  resultText: { color: COLORS.textPrimary, flex: 1, fontSize: 14 },
  resultMeta: { color: COLORS.textSecondary, fontSize: 12 },
  detailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 },
  detailLabel: { color: COLORS.textSecondary, fontSize: 13, minWidth: 150 },
  detailValue: { color: COLORS.textPrimary, flexShrink: 1, fontSize: 13, fontWeight: '600' },
  radioRow: {
    alignItems: 'center',
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  radioRowSelected: { borderColor: COLORS.primary },
  radioText: { color: COLORS.textPrimary, fontSize: 14 },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 2 },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 16,
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: COLORS.danger,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 16,
  },
  buttonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
