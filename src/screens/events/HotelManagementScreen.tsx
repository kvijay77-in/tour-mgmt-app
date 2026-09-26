/**
 * Hotels & Baggage module (MANAGE_HOTEL_ALLOCATIONS, responsive, online-only):
 * hotel master list + create/edit, room-wise stays per hotel and night
 * (by-hotel GET, server-sorted) with entry to the manual adjustment screen,
 * and the "Upload allocations" CSV action.
 *
 * See docs/Event-Engine-Design.md § HotelManagementScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { EventMessageKind, HOTEL_MESSAGES } from '../../constants/eventMessages';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useNameDirectory } from '../../context/NameDirectoryContext';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { navigateToModuleAction, useVisibleModules } from '../../navigation/modules';
import { describeUnexpectedEventError } from '../../services/api/eventsApi';
import { createHotel, listHotels, listStaysByHotel, updateHotel } from '../../services/api/hotelsApi';
import { UpdateHotelRequest } from '../../types/api';
import { Hotel, RoomAllocation } from '../../types/models';
import { AppStackParamList } from '../../types/navigation';
import { isValidDateString, toLocalDateString } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'HotelManagementScreen';
const TOAST_DURATION_MS = 4000;
const HOTEL_ID_PATTERN = /^HTL-[A-Z]{3}-\d{2}$/;

interface HotelManagementScreenProps {
  navigation: NativeStackNavigationProp<AppStackParamList, 'HotelManagement'>;
}

type Banner = { kind: EventMessageKind; message: string };

interface HotelForm {
  hotelId: string;
  name: string;
  city: string;
  address: string;
  contact: string;
  notes: string;
}

interface HotelEditor {
  original: Hotel | null;
  form: HotelForm;
}

type HotelFormErrors = Partial<Record<keyof HotelForm | 'form', string>>;

interface RoomGroup {
  roomNo: string;
  roomCapacity: number;
  stays: RoomAllocation[];
}

const EMPTY_FORM: HotelForm = { hotelId: '', name: '', city: '', address: '', contact: '', notes: '' };

function toForm(hotel: Hotel): HotelForm {
  return {
    hotelId: hotel.hotelId,
    name: hotel.name ?? '',
    city: hotel.city ?? '',
    address: hotel.address ?? '',
    contact: hotel.contact ?? '',
    notes: hotel.notes ?? '',
  };
}

function sortHotels(hotels: Hotel[]): Hotel[] {
  return [...hotels].sort((a, b) => a.name.localeCompare(b.name) || a.hotelId.localeCompare(b.hotelId));
}

/** Keeps the server order (roomNo, riderId). */
function groupByRoom(stays: RoomAllocation[]): RoomGroup[] {
  const groups: RoomGroup[] = [];
  const byRoom = new Map<string, RoomGroup>();
  for (const stay of stays) {
    const key = stay.roomNo ?? '';
    let group = byRoom.get(key);
    if (!group) {
      group = { roomNo: key, roomCapacity: stay.roomCapacity ?? 2, stays: [] };
      byRoom.set(key, group);
      groups.push(group);
    }
    group.stays.push(stay);
  }
  return groups;
}

function validateHotelForm(form: HotelForm, isCreate: boolean): HotelFormErrors {
  const errors: HotelFormErrors = {};
  if (isCreate && !HOTEL_ID_PATTERN.test(form.hotelId.trim())) errors.hotelId = HOTEL_MESSAGES.HOTEL_ID_FORMAT;
  if (!form.name.trim()) errors.name = HOTEL_MESSAGES.HOTEL_NAME_REQUIRED;
  if (!form.city.trim()) errors.city = HOTEL_MESSAGES.CITY_REQUIRED;
  if (!form.address.trim()) errors.address = HOTEL_MESSAGES.ADDRESS_REQUIRED;
  return errors;
}

export default function HotelManagementScreen({ navigation }: HotelManagementScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const { hasHome } = useVisibleModules();
  const { riderNamesById, getRiderDisplayName } = useNameDirectory();
  const tourId = tour?.tourId;

  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [editor, setEditor] = useState<HotelEditor | null>(null);
  const [editorErrors, setEditorErrors] = useState<HotelFormErrors>({});
  const [isSaving, setIsSaving] = useState(false);

  const [selectedHotelId, setSelectedHotelId] = useState<string | null>(null);
  const [stayDate, setStayDate] = useState(toLocalDateString());
  const [stays, setStays] = useState<RoomAllocation[] | null>(null);
  const [staysLoading, setStaysLoading] = useState(false);
  const [staysError, setStaysError] = useState<string | null>(null);
  const staysRequest = useRef(0);

  const [riderInput, setRiderInput] = useState('');
  const [riderInputError, setRiderInputError] = useState<string | null>(null);

  const actionsDisabled = isOffline;
  const selectedHotel = hotels.find((hotel) => hotel.hotelId === selectedHotelId) ?? null;
  const validStayDate = isValidDateString(stayDate);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const loadHotels = useCallback(async () => {
    if (!tourId || isOffline) {
      setIsLoading(false);
      return;
    }
    setBanner(null);
    try {
      const outcome = await listHotels(tourId);
      if (outcome.kind === 'error') {
        setBanner({ kind: outcome.error.kind, message: outcome.error.message });
        return;
      }
      const sorted = sortHotels(outcome.data);
      setHotels(sorted);
      setSelectedHotelId((current) => (current && sorted.some((hotel) => hotel.hotelId === current)
        ? current
        : sorted[0]?.hotelId ?? null));
    } catch (err) {
      logger.error(TAG, 'Loading hotels failed', err);
      setBanner({ kind: 'error', message: describeUnexpectedEventError(err) });
    } finally {
      setIsLoading(false);
    }
  }, [isOffline, tourId]);

  const loadStays = useCallback(async () => {
    const current = staysRequest.current + 1;
    staysRequest.current = current;
    if (!tourId || !selectedHotelId || !validStayDate || isOffline) {
      setStays(null);
      setStaysError(null);
      return;
    }
    setStaysLoading(true);
    setStaysError(null);
    try {
      const outcome = await listStaysByHotel(tourId, selectedHotelId, stayDate);
      if (current !== staysRequest.current) return;
      if (outcome.kind === 'error') {
        setStays(null);
        setStaysError(outcome.error.message);
        if (outcome.error.code === 'HOTEL_NOT_FOUND') void loadHotels();
        return;
      }
      setStays(outcome.data);
    } catch (err) {
      logger.error(TAG, 'Loading stays failed', err);
      if (current === staysRequest.current) {
        setStays(null);
        setStaysError(describeUnexpectedEventError(err));
      }
    } finally {
      if (current === staysRequest.current) setStaysLoading(false);
    }
  }, [isOffline, loadHotels, selectedHotelId, stayDate, tourId, validStayDate]);

  useFocusEffect(
    useCallback(() => {
      void loadHotels();
    }, [loadHotels]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadStays();
    }, [loadStays]),
  );

  const goHome = () => navigation.dispatch(navigateToModuleAction({ route: 'Home', params: undefined }));

  // ---- Hotel editor ------------------------------------------------------

  const openEditor = (hotel: Hotel | null) => {
    setEditor({ original: hotel, form: hotel ? toForm(hotel) : { ...EMPTY_FORM } });
    setEditorErrors({});
  };

  const updateForm = (patch: Partial<HotelForm>) => {
    setEditor((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current));
  };

  const saveHotel = async () => {
    if (!editor || !tourId) return;
    const isCreate = !editor.original;
    const { form } = editor;
    const errors = validateHotelForm(form, isCreate);
    setEditorErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    try {
      if (isCreate) {
        const contact = form.contact.trim();
        const notes = form.notes.trim();
        const outcome = await createHotel(tourId, {
          hotelId: form.hotelId.trim(),
          name: form.name.trim(),
          city: form.city.trim(),
          address: form.address.trim(),
          ...(contact ? { contact } : {}),
          ...(notes ? { notes } : {}),
        });
        if (outcome.kind === 'error') {
          if (outcome.error.code === 'HOTEL_ALREADY_EXISTS') setEditorErrors({ hotelId: outcome.error.message });
          else setEditorErrors({ form: outcome.error.message });
          return;
        }
        setHotels((current) => sortHotels([...current, outcome.data]));
        setSelectedHotelId(outcome.data.hotelId);
        setEditor(null);
        setToast(`Hotel ${outcome.data.name} created.`);
        return;
      }

      const original = toForm(editor.original!);
      const body: UpdateHotelRequest = {};
      (['name', 'city', 'address', 'contact', 'notes'] as const).forEach((field) => {
        const value = form[field].trim();
        if (value !== original[field].trim()) body[field] = value;
      });
      if (Object.keys(body).length === 0) {
        setEditor(null);
        return;
      }
      const outcome = await updateHotel(tourId, editor.original!.hotelId, body);
      if (outcome.kind === 'error') {
        setEditorErrors({ form: outcome.error.message });
        if (outcome.error.code === 'HOTEL_NOT_FOUND') void loadHotels();
        return;
      }
      setHotels((current) => sortHotels(current.map((hotel) => (hotel.hotelId === outcome.data.hotelId ? outcome.data : hotel))));
      setEditor(null);
      setToast(`Hotel ${outcome.data.name} updated.`);
    } catch (err) {
      logger.error(TAG, 'Saving hotel failed', err);
      setEditorErrors({ form: describeUnexpectedEventError(err) });
    } finally {
      setIsSaving(false);
    }
  };

  // ---- Allocate a rider --------------------------------------------------

  const openAdjust = (riderId: string) => {
    navigation.navigate('HotelAllocationAdjust', { riderId, stayDate });
  };

  const allocateRider = () => {
    const riderId = riderInput.trim().toUpperCase();
    if (!riderId) return;
    const hasDirectory = Object.keys(riderNamesById).length > 0;
    if (hasDirectory && !(riderId in riderNamesById)) {
      setRiderInputError(HOTEL_MESSAGES.RIDER_NOT_IN_TOUR.replace('{riderId}', riderId));
      return;
    }
    setRiderInputError(null);
    setRiderInput('');
    openAdjust(riderId);
  };

  // ---- Rendering ---------------------------------------------------------

  const renderField = (
    field: keyof HotelForm,
    label: string,
    options: { editable?: boolean; multiline?: boolean; placeholder?: string } = {},
  ) => {
    if (!editor) return null;
    const editable = options.editable ?? true;
    const error = editorErrors[field];
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={field === 'hotelId' ? 'characters' : 'sentences'}
          editable={editable && !isSaving && !actionsDisabled}
          multiline={options.multiline}
          onChangeText={(value) => updateForm({ [field]: value })}
          placeholder={options.placeholder}
          placeholderTextColor={COLORS.textDisabled}
          style={[styles.input, options.multiline && styles.inputMultiline, error ? styles.inputError : null, !editable && styles.inputReadOnly]}
          value={editor.form[field]}
        />
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  };

  const renderEditor = () => {
    if (!editor) return null;
    const isCreate = !editor.original;
    const disabled = isSaving || actionsDisabled;
    return (
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{isCreate ? 'New hotel' : `Edit ${editor.original!.name}`}</Text>
        {editorErrors.form ? <StatusBanner kind="error" message={editorErrors.form} /> : null}
        {renderField('hotelId', 'Hotel ID', { editable: isCreate, placeholder: 'HTL-MDU-01' })}
        {renderField('name', 'Name')}
        {renderField('city', 'City')}
        {renderField('address', 'Address', { multiline: true })}
        {renderField('contact', 'Contact (optional)')}
        {renderField('notes', 'Notes (optional)', { multiline: true })}
        <View style={styles.panelActions}>
          <TouchableOpacity accessibilityRole="button" disabled={isSaving} onPress={() => setEditor(null)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void saveHotel()}
            style={[styles.primaryButton, disabled && styles.disabled]}
          >
            {isSaving ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>{isCreate ? 'Create' : 'Save'}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderHotelList = () => (
    <View style={styles.column}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Hotels ({hotels.length})</Text>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={actionsDisabled || Boolean(editor)}
          onPress={() => openEditor(null)}
          style={[styles.toolbarButton, (actionsDisabled || Boolean(editor)) && styles.disabled]}
        >
          <MaterialIcons name="add" size={18} color={COLORS.primary} />
          <Text style={styles.toolbarButtonText}>New hotel</Text>
        </TouchableOpacity>
      </View>
      {editor && !editor.original ? renderEditor() : null}
      {!isLoading && hotels.length === 0 && !isOffline ? <Text style={styles.empty}>{HOTEL_MESSAGES.NO_HOTELS}</Text> : null}
      {hotels.map((hotel) => {
        const selected = hotel.hotelId === selectedHotelId;
        const isEditing = editor?.original?.hotelId === hotel.hotelId;
        return (
          <View key={hotel.hotelId} style={[styles.hotelCard, selected && styles.hotelCardSelected]}>
            <TouchableOpacity
              accessibilityLabel={`Show rooms at ${hotel.name}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setSelectedHotelId(hotel.hotelId)}
              style={styles.hotelInfo}
            >
              <Text style={styles.hotelName}>{hotel.name}</Text>
              <Text style={styles.metaText}>{hotel.city} · {hotel.hotelId}</Text>
              {hotel.address ? <Text style={styles.metaText}>{hotel.address}</Text> : null}
              {hotel.contact ? <Text style={styles.metaText}>{hotel.contact}</Text> : null}
              {hotel.notes ? <Text style={styles.noteText}>{hotel.notes}</Text> : null}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={`Edit ${hotel.name}`}
              accessibilityRole="button"
              disabled={actionsDisabled || (Boolean(editor) && !isEditing)}
              onPress={() => (isEditing ? setEditor(null) : openEditor(hotel))}
              style={[styles.iconButton, (actionsDisabled || (Boolean(editor) && !isEditing)) && styles.disabled]}
            >
              <MaterialIcons name="edit" size={20} color={COLORS.primary} />
            </TouchableOpacity>
            {isEditing ? <View style={styles.inlineEditor}>{renderEditor()}</View> : null}
          </View>
        );
      })}
    </View>
  );

  const renderRooms = () => {
    const groups = stays ? groupByRoom(stays) : [];
    return (
      <View style={styles.column}>
        <Text style={styles.sectionTitle}>Rooms {selectedHotel ? `· ${selectedHotel.name}` : ''}</Text>
        <View style={styles.formRow}>
          <View style={styles.formCell}>
            <Text style={styles.label}>Night (YYYY-MM-DD)</Text>
            <TextInput
              accessibilityLabel="Stay date"
              editable={!actionsDisabled}
              onChangeText={setStayDate}
              placeholder="2026-02-12"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, !validStayDate && styles.inputError]}
              value={stayDate}
            />
            {!validStayDate ? <Text style={styles.errorText}>Enter a valid date as YYYY-MM-DD.</Text> : null}
          </View>
          <View style={styles.formCell}>
            <Text style={styles.label}>Allocate a rider for this night</Text>
            <View style={styles.inlineRow}>
              <TextInput
                accessibilityLabel="Rider ID to allocate"
                autoCapitalize="characters"
                editable={!actionsDisabled}
                onChangeText={(value) => {
                  setRiderInput(value);
                  setRiderInputError(null);
                }}
                onSubmitEditing={allocateRider}
                placeholder="R57"
                placeholderTextColor={COLORS.textDisabled}
                style={[styles.input, styles.flexInput, riderInputError ? styles.inputError : null]}
                value={riderInput}
              />
              <TouchableOpacity
                accessibilityRole="button"
                disabled={actionsDisabled || !validStayDate || !riderInput.trim()}
                onPress={allocateRider}
                style={[styles.smallButton, (actionsDisabled || !validStayDate || !riderInput.trim()) && styles.disabled]}
              >
                <Text style={styles.smallButtonText}>Allocate…</Text>
              </TouchableOpacity>
            </View>
            {riderInputError ? <Text style={styles.errorText}>{riderInputError}</Text> : null}
          </View>
        </View>

        {staysError ? <StatusBanner kind="error" message={staysError} primaryAction={{ label: 'Retry', onPress: () => void loadStays() }} /> : null}
        {staysLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}
        {!selectedHotel && hotels.length > 0 ? <Text style={styles.empty}>Select a hotel to see its rooms.</Text> : null}
        {stays && groups.length === 0 && !staysLoading ? <Text style={styles.empty}>{HOTEL_MESSAGES.NO_STAYS}</Text> : null}
        {groups.map((group) => (
          <View key={group.roomNo} style={styles.roomCard}>
            <View style={styles.roomHeader}>
              <MaterialIcons name="meeting-room" size={18} color={COLORS.textSecondary} />
              <Text style={styles.roomTitle}>Room {group.roomNo}</Text>
              <Text style={styles.metaText}>{group.stays.length}/{group.roomCapacity}</Text>
            </View>
            {group.stays.map((stay) => (
              <TouchableOpacity
                accessibilityLabel={`Adjust allocation for ${getRiderDisplayName(stay.riderId).name} ${stay.riderId}`}
                accessibilityRole="button"
                disabled={actionsDisabled}
                key={stay.riderId}
                onPress={() => openAdjust(stay.riderId)}
                style={styles.stayRow}
              >
                <View style={styles.stayInfo}>
                  <Text style={styles.stayName}>{getRiderDisplayName(stay.riderId).name} · {stay.riderId}</Text>
                  {stay.sharingWith?.length ? (
                    <Text style={styles.metaText}>Sharing with {stay.sharingWith.join(', ')}</Text>
                  ) : null}
                </View>
                {stay.source ? <Text style={styles.sourceBadge}>{stay.source === 'UPLOAD' ? 'Upload' : 'Manual'}</Text> : null}
                <MaterialIcons name="chevron-right" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title="Hotels & Baggage"
        subtitle={tour?.name}
        onBack={hasHome ? goHome : undefined}
        backIcon="home"
        right={(
          <TouchableOpacity
            accessibilityLabel="Refresh"
            accessibilityRole="button"
            disabled={actionsDisabled}
            onPress={() => {
              void loadHotels();
              void loadStays();
            }}
            style={styles.headerButton}
          >
            <MaterialIcons name="refresh" size={24} color={COLORS.white} />
          </TouchableOpacity>
        )}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
        {isOffline ? <StatusBanner kind="warning" message={HOTEL_MESSAGES.OFFLINE} /> : null}
        {toast ? <StatusBanner kind="info" message={toast} onDismiss={() => setToast(null)} /> : null}
        {banner ? (
          <StatusBanner
            kind={banner.kind}
            message={banner.message}
            onDismiss={() => setBanner(null)}
            primaryAction={{ label: 'Retry', onPress: () => void loadHotels() }}
          />
        ) : null}

        <View style={styles.toolbar}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={actionsDisabled || !tourId}
            onPress={() => navigation.navigate('HotelAllocationUpload')}
            style={[styles.toolbarButton, (actionsDisabled || !tourId) && styles.disabled]}
          >
            <MaterialIcons name="upload-file" size={18} color={COLORS.primary} />
            <Text style={styles.toolbarButtonText}>Upload allocations</Text>
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <ActivityIndicator color={COLORS.primary} style={styles.loader} />
        ) : (
          <View style={[styles.layout, isDesktop && styles.layoutDesktop]}>
            {renderHotelList()}
            {renderRooms()}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  headerButton: { padding: 4 },
  content: { alignSelf: 'center', maxWidth: 1100, padding: 16, paddingBottom: 32, width: '100%' },
  loader: { marginVertical: 24 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  toolbarButton: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  toolbarButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
  layout: { gap: 16 },
  layoutDesktop: { alignItems: 'flex-start', flexDirection: 'row' },
  column: { flex: 1, gap: 10, minWidth: 0 },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  empty: { color: COLORS.textSecondary, paddingVertical: 16, textAlign: 'center' },
  hotelCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
  },
  hotelCardSelected: { borderColor: COLORS.primary, borderWidth: 2 },
  hotelInfo: { flex: 1, gap: 2, minWidth: 0 },
  hotelName: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
  metaText: { color: COLORS.textSecondary, fontSize: 12 },
  noteText: { color: COLORS.textSecondary, fontSize: 12, fontStyle: 'italic' },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  inlineEditor: { marginTop: 10, width: '100%' },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.primary,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  panelTitle: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  panelActions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  formRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  formCell: { flexBasis: 200, flexGrow: 1 },
  inlineRow: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  field: { marginTop: 8 },
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
  flexInput: { flex: 1 },
  inputMultiline: { minHeight: 64, textAlignVertical: 'top' },
  inputError: { borderColor: COLORS.danger },
  inputReadOnly: { backgroundColor: COLORS.gray[100], color: COLORS.textSecondary },
  errorText: { color: COLORS.danger, fontSize: 12, marginTop: 4 },
  roomCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  roomHeader: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 4 },
  roomTitle: { color: COLORS.textPrimary, flex: 1, fontSize: 15, fontWeight: '700' },
  stayRow: {
    alignItems: 'center',
    borderTopColor: COLORS.borderLight,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingVertical: 6,
  },
  stayInfo: { flex: 1, minWidth: 0 },
  stayName: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600' },
  sourceBadge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  smallButton: {
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 12,
  },
  smallButtonText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
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
