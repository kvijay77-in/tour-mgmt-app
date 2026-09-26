/**
 * Manual single-night room allocation for one rider (MANAGE_HOTEL_ALLOCATIONS,
 * online-only). Read-only rider header, then hotel, room, capacity (2|3),
 * sharingWith (capped at capacity - 1) and optional check-in/out dates.
 * Room clash and capacity warnings are pre-checked against the by-hotel stays
 * for the night; the server's ROOM_CLASH / NON_RECIPROCAL_SHARING /
 * ROOM_CAPACITY_EXCEEDED messages are shown verbatim on save.
 *
 * See docs/Event-Engine-Design.md § HotelAllocationAdjustScreen.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { EVENT_VALIDATION_MESSAGES, EventMessageKind, HOTEL_MESSAGES } from '../../constants/eventMessages';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { describeUnexpectedEventError } from '../../services/api/eventsApi';
import { listHotels, listStaysByHotel, listStaysByRider, upsertHotelStay } from '../../services/api/hotelsApi';
import { upsertStay } from '../../services/database/hotelStayStore';
import { UpsertHotelStayRequest } from '../../types/api';
import { Hotel, RoomAllocation } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { isValidDateString } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import ReadOnlyProfileHeader from '../../components/events/ReadOnlyProfileHeader';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'HotelAllocationAdjustScreen';
const ROOM_NO_PATTERN = /^[A-Za-z0-9/-]{1,10}$/;
const ROOM_CAPACITIES = [2, 3] as const;
const MAX_RIDER_RESULTS = 8;
const ROOM_WARNING_CODES = new Set(['ROOM_CLASH', 'NON_RECIPROCAL_SHARING', 'ROOM_CAPACITY_EXCEEDED']);

interface HotelAllocationAdjustScreenProps {
  riderId: string;
  stayDate: string;
  navigation: NativeStackNavigationProp<AppStackParamList, 'HotelAllocationAdjust'>;
}

type Banner = { kind: EventMessageKind; message: string };

interface AllocationForm {
  hotelId: string | null;
  roomNo: string;
  roomCapacity: number;
  sharingWith: string[];
  checkInDate: string;
  checkOutDate: string;
}

type FormErrors = Partial<Record<'hotelId' | 'roomNo' | 'checkInDate' | 'checkOutDate', string>>;

type Occupancy =
  | { hotelId: string; status: 'loading' }
  | { hotelId: string; status: 'ready'; stays: RoomAllocation[] }
  | { hotelId: string; status: 'unavailable' };

function toForm(stay: RoomAllocation | null): AllocationForm {
  return {
    hotelId: stay?.hotelId ?? null,
    roomNo: stay?.roomNo ?? '',
    roomCapacity: stay?.roomCapacity === 3 ? 3 : 2,
    sharingWith: stay?.sharingWith ?? [],
    checkInDate: stay?.checkInDate ?? '',
    checkOutDate: stay?.checkOutDate ?? '',
  };
}

function sameRoom(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

export default function HotelAllocationAdjustScreen({ riderId, stayDate, navigation }: HotelAllocationAdjustScreenProps) {
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { riderNamesById, getRiderDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [existing, setExisting] = useState<RoomAllocation | null>(null);
  const [form, setForm] = useState<AllocationForm>(toForm(null));
  const [errors, setErrors] = useState<FormErrors>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [riderQuery, setRiderQuery] = useState('');
  const occupancyRequest = useRef(0);

  const disabled = isOffline || isSaving || isLoading;
  const riderName = getRiderDisplayName(riderId).name;
  const maxSharing = form.roomCapacity - 1;

  const load = useCallback(async () => {
    if (!tourId || isOffline) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setBanner(null);
    try {
      const [hotelsOutcome, staysOutcome] = await Promise.all([
        listHotels(tourId),
        listStaysByRider(tourId, riderId),
      ]);
      if (hotelsOutcome.kind === 'error') {
        setBanner({ kind: hotelsOutcome.error.kind, message: hotelsOutcome.error.message });
      } else {
        setHotels([...hotelsOutcome.data].sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (staysOutcome.kind === 'error') {
        setBanner({ kind: staysOutcome.error.kind, message: staysOutcome.error.message });
        return;
      }
      const stay = staysOutcome.data.find((item) => item.stayDate === stayDate) ?? null;
      setExisting(stay);
      setForm(toForm(stay));
    } catch (err) {
      logger.error(TAG, 'Loading allocation failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsLoading(false);
    }
  }, [isOffline, riderId, stayDate, tourId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hotelId = form.hotelId;
    const current = occupancyRequest.current + 1;
    occupancyRequest.current = current;
    if (!tourId || !hotelId || isOffline) {
      setOccupancy(null);
      return;
    }
    setOccupancy({ hotelId, status: 'loading' });
    (async () => {
      try {
        const outcome = await listStaysByHotel(tourId, hotelId, stayDate);
        if (current !== occupancyRequest.current) return;
        setOccupancy(outcome.kind === 'success'
          ? { hotelId, status: 'ready', stays: outcome.data }
          : { hotelId, status: 'unavailable' });
      } catch (err) {
        logger.warn(TAG, 'Occupancy pre-check failed', err);
        if (current === occupancyRequest.current) setOccupancy({ hotelId, status: 'unavailable' });
      }
    })();
  }, [form.hotelId, isOffline, stayDate, tourId]);

  const update = (patch: Partial<AllocationForm>) => setForm((current) => ({ ...current, ...patch }));

  const selectedHotel = hotels.find((hotel) => hotel.hotelId === form.hotelId) ?? null;

  const roomOccupants = useMemo(() => {
    if (occupancy?.status !== 'ready' || !form.roomNo.trim()) return [];
    return occupancy.stays.filter((stay) => stay.riderId !== riderId && sameRoom(stay.roomNo ?? '', form.roomNo));
  }, [form.roomNo, occupancy, riderId]);

  const clashWarning = useMemo(() => {
    const clashing = roomOccupants.filter((stay) => !form.sharingWith.includes(stay.riderId));
    if (clashing.length === 0) return null;
    return HOTEL_MESSAGES.ROOM_CLASH
      .replace('{roomNo}', form.roomNo.trim())
      .replace('{hotelName}', selectedHotel?.name ?? form.hotelId ?? '')
      .replace('{otherRiderName}', clashing.map((stay) => `${getRiderDisplayName(stay.riderId).name} (${stay.riderId})`).join(', '))
      .replace('{stayDate}', stayDate);
  }, [form.hotelId, form.roomNo, form.sharingWith, getRiderDisplayName, roomOccupants, selectedHotel, stayDate]);

  const capacityExceeded = useMemo(() => {
    const occupants = new Set([riderId, ...form.sharingWith, ...roomOccupants.map((stay) => stay.riderId)]);
    return form.sharingWith.length > maxSharing || occupants.size > form.roomCapacity;
  }, [form.roomCapacity, form.sharingWith, maxSharing, riderId, roomOccupants]);

  const capacityWarning = capacityExceeded
    ? HOTEL_MESSAGES.ROOM_CAPACITY
      .replace('{roomNo}', form.roomNo.trim() || '—')
      .replace('{roomCapacity}', String(form.roomCapacity))
    : null;

  const riderResults = useMemo(() => {
    const query = riderQuery.trim().toUpperCase();
    if (!query) return [];
    return Object.entries(riderNamesById)
      .filter(([id, name]) => id !== riderId
        && !form.sharingWith.includes(id)
        && (id.toUpperCase().includes(query) || (name ?? '').toUpperCase().includes(query)))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, MAX_RIDER_RESULTS);
  }, [form.sharingWith, riderId, riderNamesById, riderQuery]);

  const addSharing = (id: string) => {
    if (form.sharingWith.length >= maxSharing) return;
    update({ sharingWith: [...form.sharingWith, id] });
    setRiderQuery('');
  };

  const save = async () => {
    if (!tourId) return;
    const nextErrors: FormErrors = {};
    const roomNo = form.roomNo.trim();
    if (!form.hotelId) nextErrors.hotelId = HOTEL_MESSAGES.HOTEL_REQUIRED;
    if (!roomNo) nextErrors.roomNo = HOTEL_MESSAGES.ROOM_NO_REQUIRED;
    else if (!ROOM_NO_PATTERN.test(roomNo)) nextErrors.roomNo = HOTEL_MESSAGES.ROOM_NO_FORMAT;
    if (form.checkInDate.trim() && !isValidDateString(form.checkInDate.trim())) nextErrors.checkInDate = EVENT_VALIDATION_MESSAGES.DATE_FORMAT;
    if (form.checkOutDate.trim() && !isValidDateString(form.checkOutDate.trim())) nextErrors.checkOutDate = EVENT_VALIDATION_MESSAGES.DATE_FORMAT;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !form.hotelId || form.sharingWith.length > maxSharing) return;

    const body: UpsertHotelStayRequest = {
      hotelId: form.hotelId,
      roomNo,
      roomCapacity: form.roomCapacity,
      sharingWith: form.sharingWith,
      ...(form.checkInDate.trim() ? { checkInDate: form.checkInDate.trim() } : {}),
      ...(form.checkOutDate.trim() ? { checkOutDate: form.checkOutDate.trim() } : {}),
    };

    setIsSaving(true);
    setBanner(null);
    try {
      const outcome = await upsertHotelStay(tourId, stayDate, riderId, body);
      if (outcome.kind === 'error') {
        if (outcome.error.code === 'HOTEL_NOT_FOUND') setErrors({ hotelId: outcome.error.message });
        else {
          setBanner({
            kind: ROOM_WARNING_CODES.has(outcome.error.code) ? 'warning' : outcome.error.kind,
            message: outcome.error.message,
          });
        }
        return;
      }
      try {
        await upsertStay(outcome.data);
      } catch (err) {
        logger.warn(TAG, 'Caching saved stay failed', err);
      }
      navigation.goBack();
    } catch (err) {
      logger.error(TAG, 'Saving allocation failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsSaving(false);
    }
  };

  const renderDateField = (field: 'checkInDate' | 'checkOutDate', label: string) => (
    <View style={styles.formCell}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        onChangeText={(value) => update({ [field]: value })}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, errors[field] ? styles.inputError : null]}
        value={form[field]}
      />
      {errors[field] ? <Text style={styles.errorText}>{errors[field]}</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <EventScreenHeader title="Room allocation" subtitle={`Night of ${stayDate}`} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isOffline ? <StatusBanner kind="warning" message={HOTEL_MESSAGES.OFFLINE} /> : null}
        <ReadOnlyProfileHeader riderId={riderId} name={riderName} />
        {banner ? <StatusBanner kind={banner.kind} message={banner.message} onDismiss={() => setBanner(null)} /> : null}

        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={styles.loader} />
        ) : (
          <View style={styles.panel}>
            {existing ? (
              <Text style={styles.metaText}>
                Current: {existing.hotelId} · Room {existing.roomNo}
                {existing.source === 'UPLOAD' ? ` · From upload${existing.uploadId ? ` ${existing.uploadId}` : ''}` : ' · Manual'}
              </Text>
            ) : (
              <Text style={styles.metaText}>No allocation yet for this night.</Text>
            )}

            <View style={styles.field}>
              <Text style={styles.label}>Hotel</Text>
              <View style={styles.chips}>
                {hotels.map((hotel) => {
                  const selected = hotel.hotelId === form.hotelId;
                  return (
                    <TouchableOpacity
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled }}
                      disabled={disabled}
                      key={hotel.hotelId}
                      onPress={() => update({ hotelId: hotel.hotelId })}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{hotel.name} · {hotel.city}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {hotels.length === 0 ? <Text style={styles.hint}>{HOTEL_MESSAGES.NO_HOTELS}</Text> : null}
              {errors.hotelId ? <Text style={styles.errorText}>{errors.hotelId}</Text> : null}
            </View>

            <View style={styles.formRow}>
              <View style={styles.formCell}>
                <Text style={styles.label}>Room number</Text>
                <TextInput
                  accessibilityLabel="Room number"
                  autoCapitalize="characters"
                  editable={!disabled}
                  maxLength={10}
                  onChangeText={(roomNo) => update({ roomNo })}
                  placeholder="204"
                  placeholderTextColor={COLORS.textDisabled}
                  style={[styles.input, errors.roomNo ? styles.inputError : null]}
                  value={form.roomNo}
                />
                {errors.roomNo ? <Text style={styles.errorText}>{errors.roomNo}</Text> : null}
              </View>
              <View style={styles.formCell}>
                <Text style={styles.label}>Room capacity</Text>
                <View style={styles.chips}>
                  {ROOM_CAPACITIES.map((capacity) => {
                    const selected = form.roomCapacity === capacity;
                    return (
                      <TouchableOpacity
                        accessibilityLabel={`Capacity ${capacity}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled }}
                        disabled={disabled}
                        key={capacity}
                        onPress={() => update({ roomCapacity: capacity })}
                        style={[styles.chip, styles.capacityChip, selected && styles.chipSelected]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{capacity}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            {occupancy?.status === 'loading' ? <ActivityIndicator color={COLORS.primary} size="small" style={styles.inlineLoader} /> : null}
            {occupancy?.status === 'unavailable' ? <Text style={styles.hint}>{HOTEL_MESSAGES.CLASH_CHECK_UNAVAILABLE}</Text> : null}
            {clashWarning ? <StatusBanner kind="warning" message={clashWarning} /> : null}
            {capacityWarning ? <StatusBanner kind="warning" message={capacityWarning} /> : null}

            <View style={styles.field}>
              <Text style={styles.label}>Sharing with ({form.sharingWith.length}/{maxSharing})</Text>
              <View style={styles.chips}>
                {form.sharingWith.map((id) => (
                  <TouchableOpacity
                    accessibilityLabel={`Remove ${getRiderDisplayName(id).name} ${id}`}
                    accessibilityRole="button"
                    disabled={disabled}
                    key={id}
                    onPress={() => update({ sharingWith: form.sharingWith.filter((item) => item !== id) })}
                    style={[styles.chip, styles.chipSelected, styles.removableChip]}
                  >
                    <Text style={styles.chipTextSelected}>{getRiderDisplayName(id).name} · {id}</Text>
                    <MaterialIcons name="close" size={14} color={COLORS.white} />
                  </TouchableOpacity>
                ))}
              </View>
              {form.sharingWith.length < maxSharing ? (
                <>
                  <TextInput
                    accessibilityLabel="Search rider to share with"
                    autoCapitalize="characters"
                    editable={!disabled}
                    onChangeText={setRiderQuery}
                    placeholder="Search by rider ID or name"
                    placeholderTextColor={COLORS.textDisabled}
                    style={[styles.input, styles.searchInput]}
                    value={riderQuery}
                  />
                  {riderResults.map(([id, name]) => (
                    <TouchableOpacity
                      accessibilityLabel={`Share with ${name ?? id} ${id}`}
                      accessibilityRole="button"
                      disabled={disabled}
                      key={id}
                      onPress={() => addSharing(id)}
                      style={styles.resultRow}
                    >
                      <MaterialIcons name="person-add-alt" size={18} color={COLORS.primary} />
                      <Text style={styles.resultText}>{name ?? 'Unknown'} · {id}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <Text style={styles.hint}>The room is full for capacity {form.roomCapacity}.</Text>
              )}
            </View>

            <View style={styles.formRow}>
              {renderDateField('checkInDate', 'Check-in date (optional)')}
              {renderDateField('checkOutDate', 'Check-out date (optional)')}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" disabled={isSaving} onPress={() => navigation.goBack()} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={disabled}
                onPress={() => void save()}
                style={[styles.primaryButton, disabled && styles.disabled]}
              >
                {isSaving ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  content: { alignSelf: 'center', maxWidth: 760, padding: 16, paddingBottom: 32, width: '100%' },
  loader: { marginVertical: 24 },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  metaText: { color: COLORS.textSecondary, fontSize: 13 },
  field: { marginBottom: 8, marginTop: 8 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  formCell: { flexBasis: 200, flexGrow: 1 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
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
  searchInput: { marginTop: 8 },
  inputError: { borderColor: COLORS.danger },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  inlineLoader: { alignSelf: 'flex-start', marginVertical: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 12,
  },
  capacityChip: { minWidth: 48 },
  removableChip: { flexDirection: 'row', gap: 4 },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textPrimary, fontSize: 13 },
  chipTextSelected: { color: COLORS.white, fontSize: 13, fontWeight: '600' },
  resultRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.borderLight,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
  },
  resultText: { color: COLORS.textPrimary, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 16 },
  secondaryButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 14 },
  secondaryButtonText: { color: COLORS.textSecondary, fontSize: 14, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 110,
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
