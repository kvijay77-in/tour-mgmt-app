import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { COLORS } from '../../constants/colors';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import { createTour, getTourById, listTours, provisionTour, reprovisionTour, updateTour } from '../../services/api/tourApi';
import { createRide, listRides, updateRide } from '../../services/api/rideApi';
import { CreateTourRequest } from '../../types/api';
import { Ride, RideStatus, StageType, Tour } from '../../types/models';
import { logger } from '../../utils/logger';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import {
  addPitStop as addRidePitStop,
  createRideDraft,
  isRideDirty,
  movePitStop,
  removePitStop as removeRidePitStop,
  ridePayload,
  toRideDraft,
  validateRide,
  RideDraft,
  StageDraft,
} from '../../utils/rideEditor';
import {
  getSelfQuitRidingSource,
  getStageSelfCheckInSource,
  resolveSelfQuitRiding,
  resolveStageSelfCheckIn,
  triStateToBoolean,
  TriState,
} from '../../utils/rideSelfService';
import { getEventErrorMessage } from '../../constants/eventMessages';

const TAG = 'TourManagementScreen';

interface TourForm {
  tourId: string;
  name: string;
  startDate: string;
  endDate: string;
  rideCount: string;
  description: string;
  selfQuitRidingAllowed: boolean;
}

interface TourManagementScreenProps {
  readOnly: boolean;
  onClose: () => void;
}

export default function TourManagementScreen({ readOnly, onClose }: TourManagementScreenProps) {
  const [tours, setTours] = useState<Tour[]>([]);
  const [selectedTourId, setSelectedTourId] = useState<string | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [baseline, setBaseline] = useState<TourForm | null>(null);
  const [form, setForm] = useState<TourForm>(emptyForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ridesAvailable, setRidesAvailable] = useState(false);
  const [rides, setRides] = useState<RideDraft[]>([]);
  const [rideBaselines, setRideBaselines] = useState<Record<string, string>>({});
  const [activeRideIndex, setActiveRideIndex] = useState(0);
  const [rideError, setRideError] = useState<string | null>(null);
  const [showReprovisionConfirm, setShowReprovisionConfirm] = useState(false);
  const [reprovisionResult, setReprovisionResult] = useState<string[] | null>(null);

  const isNew = selectedTourId === null;
  const isDirty = baseline === null || JSON.stringify(form) !== JSON.stringify(baseline);
  const canProvision = !tour?.provisionedAt;

  const loadTours = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loadedTours = await listTours();
      setTours(loadedTours);
    } catch (err) {
      logger.error(TAG, 'Failed to load tours', err);
      setError(toFriendlyError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTours();
  }, [loadTours]);

  const selectTour = useCallback(async (tourId: string) => {
    setSelectedTourId(tourId);
    setReprovisionResult(null);
    setIsLoading(true);
    setError(null);
    try {
      const summary = tours.find((item) => item.tourId === tourId) ?? null;
      const loadedTour = await getTourById(tourId);
      const selectedTour = loadedTour ?? summary;
      if (!selectedTour) {
        setError('This tour definition is not available. You can create it as a new tour.');
        return;
      }
      setTour(selectedTour);
      const nextForm = formFromTour(selectedTour);
      setForm(nextForm);
      setBaseline(nextForm);

      try {
        const loadedRides = await listRides(tourId);
        const nextRides = fillRideDrafts(loadedRides, selectedTour.rideCount);
        setRides(nextRides);
        setRideBaselines(Object.fromEntries(loadedRides.map((ride) => [ride.rideId, JSON.stringify(ridePayload(toRideDraft(ride)))])));
        setActiveRideIndex(0);
        setRidesAvailable(Boolean(selectedTour.provisionedAt));
      } catch (err) {
        if (isNotFound(err)) {
          setRides(fillRideDrafts([], selectedTour.rideCount));
          setRideBaselines({});
          setActiveRideIndex(0);
          setRidesAvailable(false);
        } else {
          throw err;
        }
      }
    } catch (err) {
      logger.error(TAG, `Failed to load tour ${tourId}`, err);
      setError(toFriendlyError(err));
    } finally {
      setIsLoading(false);
    }
  }, [tours]);

  const startNewTour = useCallback(() => {
    setSelectedTourId(null);
    setTour(null);
    setReprovisionResult(null);
    setForm(emptyForm());
    setBaseline(null);
    setRidesAvailable(false);
    setRides(fillRideDrafts([], Number(form.rideCount) || 1));
    setRideBaselines({});
    setActiveRideIndex(0);
    setRideError(null);
    setError(null);
  }, [form.rideCount]);

  const validate = useCallback((): string | null => validateTourForm(form), [form]);

  const applyResponse = useCallback((updatedTour: Tour) => {
    setTour(updatedTour);
    setSelectedTourId(updatedTour.tourId);
    const nextForm = formFromTour(updatedTour);
    setForm(nextForm);
    setBaseline(nextForm);
    setRidesAvailable(Boolean(updatedTour.provisionedAt));
    setRides((current) => fillRideDrafts(current, updatedTour.rideCount));
    setTours((current) => {
      const withoutCurrent = current.filter((item) => item.tourId !== updatedTour.tourId);
      return [...withoutCurrent, updatedTour].sort((a, b) => a.tourId.localeCompare(b.tourId));
    });
  }, []);

  const handleSave = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const request = requestFromForm(form);
      const savedTour = isNew
        ? await createTour(request)
        : await updateTour(form.tourId, { ...request, tourId: form.tourId });
      applyResponse(savedTour);
    } catch (err) {
      logger.error(TAG, 'Failed to save tour', err);
      setError(toFriendlyError(err));
    } finally {
      setIsSaving(false);
    }
  }, [applyResponse, form, isNew, validate]);

  const handleProvision = useCallback(async () => {
    if (!canProvision) {
      setError('This tour has already been provisioned. Provisioning is allowed only once.');
      return;
    }
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const request = requestFromForm(form);
      const savedTour = isNew
        ? await provisionTour({ ...request, provisioning: true })
        : await updateTour(form.tourId, isDirty
          ? { ...request, tourId: form.tourId, provisioning: true }
          : { tourId: form.tourId, provisionOnly: true });
      applyResponse(savedTour);
    } catch (err) {
      logger.error(TAG, 'Failed to provision tour', err);
      setError(toFriendlyError(err));
    } finally {
      setIsSaving(false);
    }
  }, [applyResponse, canProvision, form, isDirty, isNew, validate]);

  const handleReprovision = useCallback(async () => {
    if (readOnly || !tour?.provisionedAt) return;
    setIsSaving(true);
    setError(null);
    setReprovisionResult(null);
    try {
      const result = await reprovisionTour(tour.tourId);
      applyResponse(result.tour);
      setReprovisionResult(result.provisionedTables);
    } catch (err) {
      logger.error(TAG, 'Failed to re-provision tour', err);
      setError(toFriendlyError(err));
    } finally {
      setIsSaving(false);
      setShowReprovisionConfirm(false);
    }
  }, [applyResponse, readOnly, tour]);

  const updateField = useCallback((field: keyof TourForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'rideCount') {
      setRides((current) => fillRideDrafts(current, Number(value) || 1));
    }
  }, []);

  const updateRideField = useCallback((field: keyof RideDraft, value: string) => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex ? {
      ...ride,
      [field]: field === 'rideNo' || field === 'totalDistance' ? Number(value) : value,
    } : ride));
  }, [activeRideIndex]);

  const updateStageField = useCallback((stageIndex: number, field: keyof StageDraft, value: string) => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex ? {
      ...ride,
      pitStops: ride.pitStops.map((stage, currentIndex) => currentIndex === stageIndex ? { ...stage, [field]: value } : stage),
    } : ride));
  }, [activeRideIndex]);

  const updateStagePolicy = useCallback((stage: 'start' | 'finish', value: TriState) => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex
      ? { ...ride, [stage]: { ...ride[stage], selfCheckIn: value } }
      : ride));
  }, [activeRideIndex]);

  const updatePitStopPolicy = useCallback((stageIndex: number, value: TriState) => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex ? {
      ...ride,
      pitStops: ride.pitStops.map((stage, currentIndex) => currentIndex === stageIndex ? { ...stage, selfCheckIn: value } : stage),
    } : ride));
  }, [activeRideIndex]);

  const addPitStop = useCallback(() => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex ? {
      ...addRidePitStop(ride),
    } : ride));
  }, [activeRideIndex]);

  const removePitStop = useCallback((stageIndex: number) => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex ? {
      ...removeRidePitStop(ride, stageIndex),
    } : ride));
  }, [activeRideIndex]);

  const reorderPitStop = useCallback((stageIndex: number, direction: 'up' | 'down') => {
    setRides((current) => current.map((ride, index) => index === activeRideIndex
      ? movePitStop(ride, stageIndex, direction)
      : ride));
  }, [activeRideIndex]);

  const saveRide = useCallback(async (ride: RideDraft): Promise<Ride | null> => {
    const validationError = validateRide(ride);
    if (validationError) {
      setRideError(validationError);
      return null;
    }
    setIsSaving(true);
    setRideError(null);
    try {
      const payload = ridePayload(ride);
      const savedRide = rideBaselines[ride.rideId]
        ? await updateRide(form.tourId, ride.rideId, payload)
        : await createRide(form.tourId, payload);
      const nextRide = toRideDraft(savedRide);
      setRides((current) => current.map((item) => item.rideId === ride.rideId ? nextRide : item));
      setRideBaselines((current) => ({ ...current, [savedRide.rideId]: JSON.stringify(ridePayload(nextRide)) }));
      return savedRide;
    } catch (err) {
      logger.error(TAG, `Failed to save ride ${ride.rideId}`, err);
      setRideError(`${ride.rideId}: ${toFriendlyError(err)}`);
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [form.tourId, rideBaselines]);

  const saveAll = useCallback(async () => {
    if (readOnly || !tour) return;
    const invalidRideIndex = rides.findIndex((ride) => ride.layoutIssue !== null);
    if (invalidRideIndex >= 0) {
      setActiveRideIndex(invalidRideIndex);
      setRideError(`Save All stopped at ${rides[invalidRideIndex].rideId}: ${rides[invalidRideIndex].layoutIssue}`);
      return;
    }
    const tourValidationError = validateTourForm(form);
    if (tourValidationError) {
      setError(tourValidationError);
      return;
    }
    setIsSaving(true);
    setError(null);
    setRideError(null);
    try {
      let savedTour = tour;
      const tourRequest = requestFromForm(form);
      if (!tour.provisionedAt) {
        savedTour = isNew
          ? await provisionTour({ ...tourRequest, provisioning: true })
          : await updateTour(form.tourId, isDirty
            ? { ...tourRequest, tourId: form.tourId, provisioning: true }
            : { tourId: form.tourId, provisionOnly: true });
        applyResponse(savedTour);
      } else if (isDirty) {
        savedTour = await updateTour(form.tourId, { ...tourRequest, tourId: form.tourId });
        applyResponse(savedTour);
      }
      if (!savedTour.provisionedAt) {
        setError('Tour must be provisioned successfully before rides can be saved.');
        return;
      }
      for (const ride of rides) {
        const isRideDirty = !rideBaselines[ride.rideId] || JSON.stringify(ridePayload(ride)) !== rideBaselines[ride.rideId];
        if (isRideDirty && !await saveRide(ride)) {
          setRideError(`Save All stopped at ${ride.rideId}. Later rides were not saved.`);
          return;
        }
      }
    } catch (err) {
      logger.error(TAG, 'Save All failed', err);
      setError(`Save All stopped: ${toFriendlyError(err)}`);
    } finally {
      setIsSaving(false);
    }
  }, [applyResponse, form, isDirty, isNew, readOnly, rideBaselines, rides, saveRide, tour]);

  const activeRide = rides[activeRideIndex];
  const canEditActiveRide = Boolean(activeRide && !readOnly && (!rideBaselines[activeRide.rideId] || activeRide.status === RideStatus.PLANNED || activeRide.status === RideStatus.ACTIVE));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Define/Update Tour</Text>
        <TouchableOpacity onPress={onClose} accessibilityRole="button">
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
      {isLoading ? <ActivityIndicator size="large" color={COLORS.primary} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {error && <Text style={styles.error}>{error}</Text>}
          <Text style={styles.sectionTitle}>Tour selection</Text>
          <View style={styles.selectionRow}>
            {tours.map((item) => (
              <TouchableOpacity
                key={item.tourId}
                style={[styles.selectionButton, item.tourId === selectedTourId && styles.selectedButton]}
                onPress={() => void selectTour(item.tourId)}
                disabled={isSaving}
              >
                <Text style={styles.selectionText}>{item.tourId}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.newButton} onPress={startNewTour} disabled={isSaving}>
              <Text style={styles.newButtonText}>New tour</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>Tour definition</Text>
          <Field label="Tour ID" value={form.tourId} onChangeText={(value) => updateField('tourId', value)} disabled={!isNew || readOnly || isSaving} />
          <Field label="Name" value={form.name} onChangeText={(value) => updateField('name', value)} disabled={readOnly || isSaving} />
          <View style={styles.fieldRow}>
            <Field label="Start date" value={form.startDate} onChangeText={(value) => updateField('startDate', value)} disabled={readOnly || isSaving} />
            <Field label="End date" value={form.endDate} onChangeText={(value) => updateField('endDate', value)} disabled={readOnly || isSaving} />
          </View>
          <Field label="Ride count" value={form.rideCount} onChangeText={(value) => updateField('rideCount', value)} keyboardType="numeric" disabled={readOnly || isSaving} />
          <Field label="Description (optional)" value={form.description} onChangeText={(value) => updateField('description', value)} disabled={readOnly || isSaving} multiline />
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.label}>Riders may self check-in as Quit Riding</Text>
            </View>
            <Switch
              value={form.selfQuitRidingAllowed}
              onValueChange={(value) => setForm((current) => ({ ...current, selfQuitRidingAllowed: value }))}
              disabled={readOnly || isSaving}
              accessibilityLabel="Riders may self check-in as Quit Riding"
            />
          </View>

          {tour && <View style={styles.statusBox}>
            <Text style={styles.statusText}>Status: {tour.status}</Text>
            <Text style={styles.statusText}>Provisioned: {tour.provisionedAt ?? 'No'}</Text>
          </View>}

          {!readOnly && <View style={styles.actions}>
            <TouchableOpacity style={[styles.actionButton, (!isDirty || isSaving) && styles.disabledButton]} onPress={() => void handleSave()} disabled={!isDirty || isSaving}>
              <Text style={styles.actionText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, (!canProvision || isSaving) && styles.disabledButton]} onPress={() => void handleProvision()} disabled={!canProvision || isSaving}>
              <Text style={styles.actionText}>Provision</Text>
            </TouchableOpacity>
            {tour?.provisionedAt && (
              <TouchableOpacity style={[styles.actionButton, isSaving && styles.disabledButton]} onPress={() => setShowReprovisionConfirm(true)} disabled={isSaving} accessibilityRole="button">
                <Text style={styles.actionText}>Re-provision tables</Text>
              </TouchableOpacity>
            )}
          </View>}
          {reprovisionResult && <View style={styles.statusBox}>
            <Text style={styles.statusText}>
              {reprovisionResult.length > 0
                ? `Re-provisioning created ${reprovisionResult.length} table(s):`
                : 'Re-provisioning found no missing tables. Nothing was created.'}
            </Text>
            {reprovisionResult.map((table) => <Text key={table} style={styles.statusText}>• {table}</Text>)}
          </View>}
          <Text style={styles.rideState}>{tour?.provisionedAt && ridesAvailable ? 'Ride definitions are available.' : 'Ride definitions are locked until provisioning succeeds.'}</Text>
          {tour?.provisionedAt && rides.length > 0 && activeRide && <View style={styles.rideSection}>
            <Text style={styles.sectionTitle}>Ride definitions</Text>
            <View style={styles.tabRow}>
              {rides.map((ride, index) => (
                <TouchableOpacity key={ride.rideId} style={[styles.tab, index === activeRideIndex && styles.activeTab]} onPress={() => { setActiveRideIndex(index); setRideError(null); }}>
                  <Text style={styles.tabText}>{ride.rideId}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {rideError && <Text style={styles.error}>{rideError}</Text>}
            <Text style={styles.rideHeading}>{activeRide.rideId}</Text>
            <View style={styles.fieldRow}>
              <Field label="Ride name" value={activeRide.name} onChangeText={(value) => updateRideField('name', value)} disabled={!canEditActiveRide || isSaving} />
              <Field label="Ride number" value={String(activeRide.rideNo)} onChangeText={(value) => updateRideField('rideNo', value)} keyboardType="numeric" disabled={!canEditActiveRide || isSaving} />
            </View>
            <Field label="Date" value={activeRide.date} onChangeText={(value) => updateRideField('date', value)} disabled={!canEditActiveRide || isSaving} />
            <View style={styles.fieldRow}>
              <Field label="Start from" value={activeRide.startLocation} onChangeText={(value) => updateRideField('startLocation', value)} disabled={!canEditActiveRide || isSaving} />
              <Field label="Finish at" value={activeRide.finishLocation} onChangeText={(value) => updateRideField('finishLocation', value)} disabled={!canEditActiveRide || isSaving} />
            </View>
            <Field label="Distance (km)" value={String(activeRide.totalDistance)} onChangeText={(value) => updateRideField('totalDistance', value)} keyboardType="numeric" disabled={!canEditActiveRide || isSaving} />
            <View style={styles.fieldRow}>
              <Field label="Open time" value={activeRide.openTime} onChangeText={(value) => updateRideField('openTime', value)} disabled={!canEditActiveRide || isSaving} />
              <Field label="Flag-off time" value={activeRide.flagOffTime} onChangeText={(value) => updateRideField('flagOffTime', value)} disabled={!canEditActiveRide || isSaving} />
              <Field label="Close time" value={activeRide.closeTime} onChangeText={(value) => updateRideField('closeTime', value)} disabled={!canEditActiveRide || isSaving} />
            </View>
            <View style={styles.policySection}>
              <TriStateControl
                label="Self check-in at stages"
                value={activeRide.selfCheckIn}
                choices={['Default', 'Allowed', 'Not allowed']}
                onChange={(value) => setRides((current) => current.map((ride, index) => index === activeRideIndex ? { ...ride, selfCheckIn: value } : ride))}
                disabled={!canEditActiveRide || isSaving}
              />
              <Text style={styles.hint}>Default removes the saved ride override.</Text>
              <TriStateControl
                label="Self Quit Riding"
                value={activeRide.selfQuitRiding}
                choices={['Follow tour setting', 'Allowed', 'Not allowed']}
                onChange={(value) => setRides((current) => current.map((ride, index) => index === activeRideIndex ? { ...ride, selfQuitRiding: value } : ride))}
                disabled={!canEditActiveRide || isSaving}
              />
              <Text style={styles.resultText}>{quitRidingSummary(activeRide.selfQuitRiding, tour?.selfQuitRidingAllowed ?? false)}</Text>
            </View>
            <View style={styles.statusBox}>
              <Text style={styles.statusText}>Status: {activeRide.status}</Text>
              {activeRide.startedAt && <Text style={styles.statusText}>Started: {activeRide.startedAt}</Text>}
              {activeRide.completedAt && <Text style={styles.statusText}>Completed: {activeRide.completedAt}</Text>}
            </View>
            {activeRide.layoutIssue && (
              <Text style={styles.layoutWarning} accessibilityRole="alert">
                {activeRide.layoutIssue} Saving is blocked; correct the ride data in the backend.
              </Text>
            )}
            <View style={styles.stageCard}>
              <View style={styles.stageTitleRow}>
                <Text style={styles.stageTitle}>{activeRide.start.original?.name ?? 'Start'}</Text>
                <Text style={styles.lockedBadge}>Locked</Text>
              </View>
              {activeRide.start.original?.location && <Text style={styles.statusText}>Location: {activeRide.start.original.location}</Text>}
              <TriStateControl
                label="Self check-in"
                value={activeRide.start.selfCheckIn}
                choices={['Follow ride', 'Allowed', 'Not allowed']}
                onChange={(value) => updateStagePolicy('start', value)}
                disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)}
              />
              <Text style={styles.resultText}>{stageCheckInSummary(StageType.START, activeRide.start.selfCheckIn, activeRide.selfCheckIn)}</Text>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Self Not Riding</Text>
                <Switch
                  value={activeRide.start.selfNotRiding}
                  onValueChange={(value) => setRides((current) => current.map((ride, index) => index === activeRideIndex
                    ? { ...ride, start: { ...ride.start, selfNotRiding: value } }
                    : ride))}
                  disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)}
                  accessibilityLabel="Self Not Riding"
                />
              </View>
              <Text style={styles.hint}>Applies only while the ride is Open.</Text>
            </View>
            <View style={styles.stageHeader}>
              <Text style={styles.sectionTitle}>Pit stops</Text>
              {canEditActiveRide && !activeRide.layoutIssue && <TouchableOpacity onPress={addPitStop}><Text style={styles.addText}>+ Add pit stop</Text></TouchableOpacity>}
            </View>
            {activeRide.pitStops.map((stage, index) => <View style={styles.stageCard} key={`${activeRide.rideId}-pit-${stage.stageId ?? index}`}>
              <Text style={styles.stageTitle}>Pit stop {index + 1}</Text>
              <View style={styles.stageRow}>
                <Field label="Name" value={stage.name} onChangeText={(value) => updateStageField(index, 'name', value)} disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)} />
                <Field label="Location" value={stage.location} onChangeText={(value) => updateStageField(index, 'location', value)} disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)} />
                <Field label="Distance" value={stage.distanceFromStart} onChangeText={(value) => updateStageField(index, 'distanceFromStart', value)} keyboardType="numeric" disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)} />
                <Field label="Open offset (min)" value={stage.estimatedOpenTime} onChangeText={(value) => updateStageField(index, 'estimatedOpenTime', value)} keyboardType="numeric" disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)} />
                <Field label="Duration (min)" value={stage.pitStopDuration} onChangeText={(value) => updateStageField(index, 'pitStopDuration', value)} keyboardType="numeric" disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)} />
              </View>
              <TriStateControl
                label="Self check-in"
                value={stage.selfCheckIn}
                choices={['Follow ride', 'Allowed', 'Not allowed']}
                onChange={(value) => updatePitStopPolicy(index, value)}
                disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)}
              />
              <Text style={styles.resultText}>{stageCheckInSummary(StageType.PIT_STOP, stage.selfCheckIn, activeRide.selfCheckIn)}</Text>
              {canEditActiveRide && !activeRide.layoutIssue && <View style={styles.stageActions}>
                <TouchableOpacity onPress={() => reorderPitStop(index, 'up')} disabled={index === 0 || isSaving} accessibilityRole="button" accessibilityLabel={`Move pit stop ${index + 1} up`}>
                  <Text style={[styles.actionLink, (index === 0 || isSaving) && styles.mutedText]}>Move up</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => reorderPitStop(index, 'down')} disabled={index === activeRide.pitStops.length - 1 || isSaving} accessibilityRole="button" accessibilityLabel={`Move pit stop ${index + 1} down`}>
                  <Text style={[styles.actionLink, (index === activeRide.pitStops.length - 1 || isSaving) && styles.mutedText]}>Move down</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeButton} onPress={() => removePitStop(index)} disabled={isSaving}>
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>}
            </View>)}
            <View style={styles.stageCard}>
              <View style={styles.stageTitleRow}>
                <Text style={styles.stageTitle}>{activeRide.finish.original?.name ?? 'Finish'}</Text>
                <Text style={styles.lockedBadge}>Locked</Text>
              </View>
              {activeRide.finish.original?.location && <Text style={styles.statusText}>Location: {activeRide.finish.original.location}</Text>}
              <TriStateControl
                label="Self check-in"
                value={activeRide.finish.selfCheckIn}
                choices={['Follow ride', 'Allowed', 'Not allowed']}
                onChange={(value) => updateStagePolicy('finish', value)}
                disabled={!canEditActiveRide || isSaving || Boolean(activeRide.layoutIssue)}
              />
              <Text style={styles.resultText}>{stageCheckInSummary(StageType.FINISH, activeRide.finish.selfCheckIn, activeRide.selfCheckIn)}</Text>
            </View>
            {!readOnly && <View style={styles.actions}>
              <TouchableOpacity style={[styles.actionButton, (!canEditActiveRide || Boolean(activeRide.layoutIssue) || !isRideDirty(activeRide, rideBaselines[activeRide.rideId]) || isSaving) && styles.disabledButton]} onPress={() => void saveRide(activeRide)} disabled={!canEditActiveRide || Boolean(activeRide.layoutIssue) || !isRideDirty(activeRide, rideBaselines[activeRide.rideId]) || isSaving}>
                <Text style={styles.actionText}>Save ride</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionButton, isSaving && styles.disabledButton]} onPress={() => void saveAll()} disabled={isSaving}>
                <Text style={styles.actionText}>Save All</Text>
              </TouchableOpacity>
            </View>}
          </View>}
        </ScrollView>
      )}
      <ConfirmDialog
        visible={showReprovisionConfirm}
        title="Re-provision tables?"
        message={`Creates any missing or newly defined tables for ${tour?.tourId ?? 'this tour'}. Existing tables and data are not changed.`}
        confirmLabel="Re-provision"
        confirmTone="primary"
        isSubmitting={isSaving}
        onConfirm={() => void handleReprovision()}
        onCancel={() => setShowReprovisionConfirm(false)}
      />
    </SafeAreaView>
  );
}

function emptyForm(): TourForm {
  return { tourId: '', name: '', startDate: '', endDate: '', rideCount: '1', description: '', selfQuitRidingAllowed: false };
}

function formFromTour(tour: Tour): TourForm {
  return {
    tourId: tour.tourId,
    name: tour.name,
    startDate: tour.startDate,
    endDate: tour.endDate,
    rideCount: String(tour.rideCount),
    description: tour.description ?? '',
    selfQuitRidingAllowed: tour.selfQuitRidingAllowed ?? false,
  };
}

function requestFromForm(form: TourForm): CreateTourRequest {
  return {
    tourId: form.tourId.trim(),
    name: form.name.trim(),
    startDate: form.startDate.trim(),
    endDate: form.endDate.trim(),
    rideCount: Number(form.rideCount),
    selfQuitRidingAllowed: form.selfQuitRidingAllowed,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
}

function nextRideId(usedIds: Set<string>): string {
  let sequence = 1;
  while (usedIds.has(`RIDE${String(sequence).padStart(3, '0')}`)) sequence += 1;
  return `RIDE${String(sequence).padStart(3, '0')}`;
}

function fillRideDrafts(loadedRides: Ride[] | RideDraft[], rideCount: number): RideDraft[] {
  const existing = loadedRides.map((ride) => 'pitStops' in ride ? ride : toRideDraft(ride));
  const result = [...existing].sort((a, b) => a.rideId.localeCompare(b.rideId));
  const usedIds = new Set(result.map((ride) => ride.rideId));
  while (result.length < Math.max(1, rideCount)) {
    const rideId = nextRideId(usedIds);
    usedIds.add(rideId);
    result.push(createRideDraft(rideId));
  }
  return result;
}

function validateTourForm(form: TourForm): string | null {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,49}$/.test(form.tourId.trim())) return 'Tour ID must be 3-50 characters and use letters, numbers, dot, dash, or underscore.';
  if (!form.name.trim()) return 'Tour name is required.';
  if (!isIsoDate(form.startDate) || !isIsoDate(form.endDate)) return 'Start and end dates must use YYYY-MM-DD format.';
  if (form.endDate < form.startDate) return 'End date must be on or after the start date.';
  if (!/^\d+$/.test(form.rideCount) || Number(form.rideCount) < 1) return 'Ride count must be a positive integer.';
  return null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.statusCode === 404;
}

function toFriendlyError(error: unknown): string {
  if (isNetworkError(error)) return 'Unable to reach the server. Check your connection and try again.';
  if (error instanceof ApiError || (error as ApiError)?.name === 'ApiError') {
    const apiError = error as ApiError;
    if (apiError.errorCode?.toUpperCase() === 'INVALID_STAGE_LAYOUT') {
      return getEventErrorMessage('INVALID_STAGE_LAYOUT', apiError.message, apiError.statusCode).message;
    }
    if (apiError.statusCode === 409) return apiError.message || 'The tour conflicts with an existing definition.';
    if (apiError.statusCode === 403) return 'You do not have permission to manage tours.';
    return apiError.message || 'The tour request could not be completed.';
  }
  return 'An unexpected error occurred. Please try again.';
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  disabled: boolean;
  keyboardType?: 'default' | 'numeric';
  multiline?: boolean;
}

function Field({ label, value, onChangeText, disabled, keyboardType = 'default', multiline = false }: FieldProps) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput style={[styles.input, multiline && styles.multiline]} value={value} onChangeText={onChangeText} editable={!disabled} keyboardType={keyboardType} multiline={multiline} />
  </View>;
}

interface TriStateControlProps {
  label: string;
  value: TriState;
  choices: [string, string, string];
  onChange: (value: TriState) => void;
  disabled: boolean;
}

function TriStateControl({ label, value, choices, onChange, disabled }: TriStateControlProps) {
  const values: TriState[] = ['default', 'allowed', 'notAllowed'];
  return (
    <View style={styles.triStateControl}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segmentedControl} accessibilityRole="radiogroup">
        {values.map((option, index) => {
          const selected = value === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.segment, selected && styles.segmentSelected, disabled && styles.segmentDisabled]}
              onPress={() => onChange(option)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={choices[index]}
              accessibilityState={{ selected, disabled }}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{choices[index]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function stageCheckInSummary(stageType: StageType, stageValue: TriState, rideValue: TriState): string {
  const stage = { type: stageType, selfCheckInAllowed: triStateToBoolean(stageValue) };
  const ride = { selfCheckInAllowed: triStateToBoolean(rideValue) };
  const result = resolveStageSelfCheckIn(stage, ride);
  const source = getStageSelfCheckInSource(stage, ride);
  const sourceLabel = source === 'stage' ? 'stage setting' : source === 'ride' ? 'ride setting' : 'default';
  return `Result: ${result ? 'Allowed' : 'Not allowed'} (${sourceLabel})`;
}

function quitRidingSummary(rideValue: TriState, tourValue: boolean): string {
  const ride = { selfQuitRidingAllowed: triStateToBoolean(rideValue) };
  const tour = { selfQuitRidingAllowed: tourValue };
  const result = resolveSelfQuitRiding(ride, tour);
  const source = getSelfQuitRidingSource(ride, tour);
  const sourceLabel = source === 'ride' ? 'ride setting' : source === 'tour' ? 'tour setting' : 'default';
  return `Tour setting: ${tourValue ? 'Allowed' : 'Not allowed'}. Result: ${result ? 'Allowed' : 'Not allowed'} (${sourceLabel})`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.textPrimary },
  closeText: { color: COLORS.primary, fontWeight: '600' },
  content: { padding: 20, maxWidth: 900, width: '100%', alignSelf: 'center' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary, marginTop: 18, marginBottom: 10 },
  selectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectionButton: { borderWidth: 1, borderColor: COLORS.borderLight, paddingHorizontal: 12, paddingVertical: 9 },
  selectedButton: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '15' },
  selectionText: { color: COLORS.textPrimary },
  newButton: { backgroundColor: COLORS.gray[100], paddingHorizontal: 12, paddingVertical: 9 },
  newButtonText: { color: COLORS.primary, fontWeight: '600' },
  fieldRow: { flexDirection: 'row', gap: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  switchCopy: { flex: 1 },
  policySection: { marginTop: 16, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLORS.borderLight, gap: 8 },
  triStateControl: { gap: 6, marginTop: 8 },
  segmentedControl: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segment: { borderWidth: 1, borderColor: COLORS.borderLight, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: COLORS.white },
  segmentSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segmentDisabled: { opacity: 0.55 },
  segmentText: { color: COLORS.textPrimary, fontSize: 13 },
  segmentTextSelected: { color: COLORS.white, fontWeight: '700' },
  resultText: { color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  hint: { color: COLORS.textSecondary, fontSize: 12 },
  layoutWarning: { color: COLORS.danger, backgroundColor: COLORS.danger + '12', padding: 12, marginTop: 12, fontWeight: '600' },
  stageCard: { borderTopWidth: 1, borderColor: COLORS.borderLight, paddingVertical: 12, gap: 8 },
  stageTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stageTitle: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 15 },
  lockedBadge: { color: COLORS.textSecondary, borderWidth: 1, borderColor: COLORS.borderLight, paddingHorizontal: 8, paddingVertical: 3, fontSize: 11 },
  stageActions: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
  actionLink: { color: COLORS.primary, fontWeight: '600' },
  mutedText: { color: COLORS.textSecondary, opacity: 0.5 },
  field: { flex: 1, marginBottom: 12, minWidth: 140 },
  label: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 5 },
  input: { borderWidth: 1, borderColor: COLORS.borderLight, paddingHorizontal: 10, paddingVertical: 9, color: COLORS.textPrimary, backgroundColor: COLORS.white },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  statusBox: { backgroundColor: COLORS.gray[50], padding: 12, marginTop: 8, gap: 4 },
  statusText: { color: COLORS.textSecondary, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  actionButton: { backgroundColor: COLORS.primary, paddingHorizontal: 22, paddingVertical: 12 },
  disabledButton: { opacity: 0.45 },
  actionText: { color: COLORS.white, fontWeight: '700' },
  rideState: { color: COLORS.textSecondary, marginTop: 20, fontSize: 13 },
  rideSection: { marginTop: 8 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  tab: { paddingHorizontal: 12, paddingVertical: 9, backgroundColor: COLORS.gray[100] },
  activeTab: { backgroundColor: COLORS.primary },
  tabText: { color: COLORS.textPrimary, fontWeight: '600' },
  rideHeading: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700', marginVertical: 14 },
  stageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addText: { color: COLORS.primary, fontWeight: '700' },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: COLORS.borderLight, paddingTop: 8 },
  removeButton: { backgroundColor: COLORS.danger, paddingHorizontal: 13, paddingVertical: 11, marginBottom: 12 },
  removeText: { color: COLORS.white, fontWeight: '700', fontSize: 18 },
  error: { color: COLORS.danger, backgroundColor: COLORS.danger + '12', padding: 12, marginBottom: 8 },
});