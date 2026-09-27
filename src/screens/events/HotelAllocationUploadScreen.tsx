/**
 * Hotel allocation CSV upload (MANAGE_HOTEL_ALLOCATIONS, online-only, onClose
 * modal). Every attempt presigns anew, PUTs the file as text/csv, then polls
 * the upload status every 3 s for up to 3 minutes. Outcomes are all-or-nothing:
 * APPLIED, REJECTED (RowErrorTable) or processing failed (server message).
 * The last uploadId per tour is kept in AsyncStorage so reopening resumes
 * polling (D-R). The size pre-check uses AppConfig HOTEL_UPLOAD/PROCESSING
 * maxFileSizeBytes when available (D-S).
 *
 * See docs/Event-Engine-Design.md § HotelAllocationUploadScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { HOTEL_UPLOAD_MESSAGES } from '../../constants/eventMessages';
import { CONFIG_TYPE, HOTEL_UPLOAD_PROCESSING_CONFIG_ID } from '../../constants/idCodes';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { listAppConfigs } from '../../services/api/configApi';
import { describeUnexpectedEventError } from '../../services/api/eventsApi';
import {
  getHotelUploadStatus,
  getUploadErrorGroup,
  listStaysByDate,
  presignHotelUpload,
} from '../../services/api/hotelsApi';
import { PickedFile, pickArtifactFile, uploadToPresignedUrl } from '../../services/artifacts/artifactUploader';
import { clearAllStays, replaceStaysForDate } from '../../services/database/hotelStayStore';
import { HotelUploadStatus } from '../../types/api';
import { HotelUploadProcessingConfig } from '../../types/config';
import { toLocalDateString } from '../../utils/eventActivity';
import { logger } from '../../utils/logger';
import RowErrorTable from '../../components/events/RowErrorTable';
import StatusBanner from '../../components/events/StatusBanner';

const TAG = 'HotelAllocationUploadScreen';
const POLL_INTERVAL_MS = 3_000;
const POLL_CAP_MS = 3 * 60_000;
const CSV_CONTENT_TYPE = 'text/csv';
// Native pickers filter by MIME only and CSV MIME types vary by device; the .csv name is checked after picking.
const CSV_PICKER_TYPES = Platform.OS === 'web'
  ? ['.csv', 'text/csv']
  : ['text/*', 'application/csv', 'application/vnd.ms-excel'];

const SAMPLE_CSV = [
  '# stayDates=2026-02-11,2026-02-12,2026-02-13',
  '# hotelId=HTL-MDU-01',
  'riderId,hotelId,roomNo,roomCapacity,sharingWith',
  'R1,HTL-MDU-01,204,2,R2',
  'R2,,204,2,R1',
  'R58,HTL-MDU-01,207,3,R59;R60',
].join('\n');

interface HotelAllocationUploadScreenProps {
  onClose: () => void;
}

type Phase =
  | { type: 'idle' }
  | { type: 'uploading' }
  | { type: 'uploadFailed'; message: string }
  | { type: 'validating'; uploadId: string; resumed: boolean }
  | { type: 'pollFailed'; message: string }
  | { type: 'timedOut' }
  | { type: 'applied'; status: HotelUploadStatus }
  | { type: 'rejected'; status: HotelUploadStatus; errorCount: number; showMoreHint: boolean }
  | { type: 'processingFailed'; message: string }
  | { type: 'notFound' };

function lastUploadKey(tourId: string): string {
  return `hotelUpload:lastUploadId:${tourId}`;
}

async function saveLastUploadId(tourId: string, uploadId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(lastUploadKey(tourId), uploadId);
  } catch (err) {
    logger.warn(TAG, 'Saving last uploadId failed', err);
  }
}

async function clearLastUploadId(tourId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(lastUploadKey(tourId));
  } catch (err) {
    logger.warn(TAG, 'Clearing last uploadId failed', err);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toFinalPhase(status: HotelUploadStatus): Phase {
  if (status.status === 'APPLIED') return { type: 'applied', status };
  const errors = status.errors ?? [];
  const groups = errors.map((error) => getUploadErrorGroup(error.code));
  if (errors.length > 0 && groups.every((group) => group === 'PROCESSING')) {
    return { type: 'processingFailed', message: errors.map((error) => error.message).join('\n') };
  }
  return {
    type: 'rejected',
    status,
    errorCount: status.errorCount ?? errors.length,
    showMoreHint: !(errors.length > 0 && groups.every((group) => group === 'CROSS_ROW')),
  };
}

/** APPLIED: drop cached stays and re-fetch today's so room-clash checks and staff views use the new data. */
async function refreshTodayStays(tourId: string): Promise<void> {
  try {
    await clearAllStays();
    const today = toLocalDateString();
    const outcome = await listStaysByDate(tourId, today);
    if (outcome.kind === 'success') await replaceStaysForDate(today, outcome.data);
    else logger.warn(TAG, 'Refreshing today\'s stays rejected', { code: outcome.error.code });
  } catch (err) {
    logger.warn(TAG, 'Refreshing today\'s stays failed', err);
  }
}

export default function HotelAllocationUploadScreen({ onClose }: HotelAllocationUploadScreenProps) {
  const insets = useSafeAreaInsets();
  const { tour } = useTour();
  const { isOffline } = useOffline();
  const tourId = tour?.tourId;

  const [phase, setPhase] = useState<Phase>({ type: 'idle' });
  const [file, setFile] = useState<PickedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  /** undefined while loading; null = unknown, pre-check skipped */
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useState<number | null | undefined>(undefined);
  const pollToken = useRef(0);
  const resumeChecked = useRef(false);

  useEffect(() => () => {
    pollToken.current += 1;
  }, []);

  const poll = useCallback(async (uploadId: string, resumed: boolean) => {
    if (!tourId) return;
    pollToken.current += 1;
    const token = pollToken.current;
    const deadline = Date.now() + POLL_CAP_MS;
    setPhase({ type: 'validating', uploadId, resumed });

    let first = true;
    while (token === pollToken.current) {
      if (!first || !resumed) await wait(POLL_INTERVAL_MS);
      first = false;
      if (token !== pollToken.current) return;
      try {
        const outcome = await getHotelUploadStatus(tourId, uploadId);
        if (token !== pollToken.current) return;
        if (outcome.kind === 'error') {
          if (outcome.error.status === 404) {
            await clearLastUploadId(tourId);
            setPhase({ type: 'notFound' });
          } else {
            setPhase({ type: 'pollFailed', message: outcome.error.message });
          }
          return;
        }
        const status = outcome.data;
        if (status.status === 'APPLIED' || status.status === 'REJECTED') {
          await clearLastUploadId(tourId);
          if (status.status === 'APPLIED') await refreshTodayStays(tourId);
          if (token === pollToken.current) setPhase(toFinalPhase(status));
          return;
        }
      } catch (err) {
        // Transient network/5xx: keep polling within the cap.
        logger.warn(TAG, 'Upload status poll failed', err);
      }
      if (Date.now() + POLL_INTERVAL_MS > deadline) {
        if (token === pollToken.current) setPhase({ type: 'timedOut' });
        return;
      }
    }
  }, [tourId]);

  useEffect(() => {
    if (!tourId) return undefined;
    let active = true;
    (async () => {
      try {
        const items = await listAppConfigs([CONFIG_TYPE.HOTEL_UPLOAD]);
        const item = items.find((entry) => entry.configType === CONFIG_TYPE.HOTEL_UPLOAD
          && entry.configId === HOTEL_UPLOAD_PROCESSING_CONFIG_ID
          && entry.enabled);
        const max = (item?.config as HotelUploadProcessingConfig | undefined)?.maxFileSizeBytes;
        const valid = typeof max === 'number' && Number.isFinite(max) && max > 0;
        if (!valid) logger.warn(TAG, 'HOTEL_UPLOAD/PROCESSING maxFileSizeBytes unavailable; size pre-check skipped');
        if (active) setMaxFileSizeBytes(valid ? max : null);
      } catch (err) {
        logger.warn(TAG, 'Loading HOTEL_UPLOAD config failed; size pre-check skipped', err);
        if (active) setMaxFileSizeBytes(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [tourId]);

  useEffect(() => {
    if (!tourId || isOffline || resumeChecked.current) return;
    resumeChecked.current = true;
    (async () => {
      try {
        const lastUploadId = await AsyncStorage.getItem(lastUploadKey(tourId));
        if (lastUploadId) void poll(lastUploadId, true);
      } catch (err) {
        logger.warn(TAG, 'Reading last uploadId failed', err);
      }
    })();
  }, [isOffline, poll, tourId]);

  const chooseFile = async () => {
    setFileError(null);
    setIsPicking(true);
    try {
      const picked = await pickArtifactFile(CSV_PICKER_TYPES);
      if (!picked) return;
      let error: string | null = null;
      if (!picked.name.toLowerCase().endsWith('.csv')) error = HOTEL_UPLOAD_MESSAGES.NOT_CSV;
      else if (!picked.size) error = HOTEL_UPLOAD_MESSAGES.EMPTY;
      else if (maxFileSizeBytes && picked.size > maxFileSizeBytes) {
        error = HOTEL_UPLOAD_MESSAGES.TOO_LARGE
          .replace('{size}', formatBytes(picked.size))
          .replace('{max}', formatBytes(maxFileSizeBytes));
      }
      if (error) {
        setFile(null);
        setFileError(error);
        return;
      }
      pollToken.current += 1;
      setFile(picked);
      setPhase({ type: 'idle' });
    } catch (err) {
      logger.error(TAG, 'Picking file failed', err);
      setFileError(err instanceof Error ? err.message : HOTEL_UPLOAD_MESSAGES.S3_FAILED);
    } finally {
      setIsPicking(false);
    }
  };

  const startUpload = async () => {
    if (!tourId) return;
    if (!file) {
      void chooseFile();
      return;
    }
    pollToken.current += 1;
    setPhase({ type: 'uploading' });
    try {
      const presign = await presignHotelUpload(tourId);
      if (presign.kind === 'error') {
        setPhase({ type: 'uploadFailed', message: presign.error.message });
        return;
      }
      const { uploadId, uploadUrl } = presign.data;
      try {
        await uploadToPresignedUrl(uploadUrl, { ...file, contentType: CSV_CONTENT_TYPE });
      } catch (err) {
        logger.warn(TAG, 'S3 upload failed', err);
        setPhase({ type: 'uploadFailed', message: HOTEL_UPLOAD_MESSAGES.S3_FAILED });
        return;
      }
      await saveLastUploadId(tourId, uploadId);
      void poll(uploadId, false);
    } catch (err) {
      logger.error(TAG, 'Presign failed', err);
      setPhase({ type: 'uploadFailed', message: describeUnexpectedEventError(err) });
    }
  };

  const busy = phase.type === 'uploading' || phase.type === 'validating';
  const pickDisabled = isOffline || busy || isPicking || !tourId || maxFileSizeBytes === undefined;
  const uploadDisabled = pickDisabled || !file;

  const header = (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
      <Text style={styles.headerTitle}>Upload hotel allocations</Text>
      <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" hitSlop={8} onPress={onClose}>
        <MaterialIcons name="close" size={24} color={COLORS.white} />
      </TouchableOpacity>
    </View>
  );

  if (phase.type === 'notFound') {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.centered}>
          <MaterialIcons name="cloud-off" size={48} color={COLORS.textSecondary} />
          <Text style={styles.centeredText}>{HOTEL_UPLOAD_MESSAGES.NOT_FOUND}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to hotels</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderOutcome = () => {
    switch (phase.type) {
      case 'uploading':
        return (
          <View style={styles.progress}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.progressText}>{HOTEL_UPLOAD_MESSAGES.UPLOADING}</Text>
          </View>
        );
      case 'validating':
        return (
          <View style={styles.progress}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.progressText}>
              {phase.resumed
                ? HOTEL_UPLOAD_MESSAGES.RESUMED.replace('{uploadId}', phase.uploadId)
                : HOTEL_UPLOAD_MESSAGES.VALIDATING}
            </Text>
          </View>
        );
      case 'uploadFailed':
        return (
          <StatusBanner
            kind="error"
            message={phase.message}
            primaryAction={file && !isOffline ? { label: 'Try again', onPress: () => void startUpload() } : undefined}
          />
        );
      case 'pollFailed':
        return (
          <StatusBanner
            kind="error"
            message={phase.message}
            primaryAction={!isOffline ? { label: 'Upload again', onPress: () => void startUpload() } : undefined}
          />
        );
      case 'timedOut':
        return (
          <StatusBanner
            kind="warning"
            message={HOTEL_UPLOAD_MESSAGES.STILL_VALIDATING}
            primaryAction={!isOffline ? { label: 'Upload again', onPress: () => void startUpload() } : undefined}
          />
        );
      case 'applied':
        return (
          <StatusBanner
            kind="info"
            message={HOTEL_UPLOAD_MESSAGES.APPLIED
              .replace('{appliedCount}', String(phase.status.appliedCount ?? 0))
              .replace('{rowCount}', String(phase.status.rowCount ?? 0))}
            primaryAction={{ label: 'Done', onPress: onClose }}
          />
        );
      case 'processingFailed':
        return (
          <StatusBanner
            kind="error"
            title={HOTEL_UPLOAD_MESSAGES.PROCESSING_FAILED_TITLE}
            message={phase.message}
            primaryAction={!isOffline ? { label: 'Upload again', onPress: () => void startUpload() } : undefined}
          />
        );
      case 'rejected':
        return (
          <View style={styles.rejected}>
            <StatusBanner
              kind="error"
              message={HOTEL_UPLOAD_MESSAGES.REJECTED.replace('{errorCount}', String(phase.errorCount))}
              primaryAction={!isOffline ? { label: 'Choose another file', onPress: () => void chooseFile() } : undefined}
            />
            {phase.showMoreHint ? <Text style={styles.hint}>{HOTEL_UPLOAD_MESSAGES.MORE_ISSUES}</Text> : null}
            {(phase.status.errors ?? []).length > 0 ? (
              <RowErrorTable errors={phase.status.errors ?? []} errorCount={phase.errorCount} />
            ) : null}
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {header}
      <ScrollView contentContainerStyle={styles.content}>
        {!tourId ? <StatusBanner kind="info" message="No active tour is selected." /> : null}
        {isOffline ? <StatusBanner kind="warning" message={HOTEL_UPLOAD_MESSAGES.OFFLINE} /> : null}

        <View style={styles.panel}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: showHelp }}
            onPress={() => setShowHelp((current) => !current)}
            style={styles.helpToggle}
          >
            <MaterialIcons name="help-outline" size={18} color={COLORS.primary} />
            <Text style={styles.helpToggleText}>File format</Text>
            <MaterialIcons name={showHelp ? 'expand-less' : 'expand-more'} size={20} color={COLORS.primary} />
          </TouchableOpacity>
          {showHelp ? (
            <View style={styles.help}>
              <Text style={styles.code} selectable>{SAMPLE_CSV}</Text>
              <Text style={styles.helpItem}>• Directive lines (# stayDates=…, or # startDate=… with # nights=…, plus an optional default # hotelId=…) go before the header row.</Text>
              <Text style={styles.helpItem}>• riderId and roomNo are required columns. hotelId can be left blank when a default is set. roomCapacity is 2 (default) or 3. sharingWith separates rider IDs with ;.</Text>
              <Text style={styles.helpItem}>• Each rider appears once per file. Every room-mate must name the rider back, with the same hotel, room and capacity.</Text>
              <Text style={styles.helpItem}>• What gets changed: Only the riders listed in this file are updated for these dates. Allocations for other riders stay as they are.</Text>
              <Text style={styles.helpItem}>• Error row numbers are line numbers in the file, counting directive lines, so they match the row numbers shown in a spreadsheet or text editor.</Text>
              <Text style={styles.helpItem}>• Save the file as UTF-8 (Excel: “CSV UTF-8”).</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.panel}>
          <View style={styles.fileRow}>
            <MaterialIcons name="description" size={22} color={file ? COLORS.primary : COLORS.textDisabled} />
            <View style={styles.fileInfo}>
              <Text style={styles.fileName} numberOfLines={1}>{file ? file.name : 'No file selected'}</Text>
              {file ? <Text style={styles.metaText}>{formatBytes(file.size)}</Text> : null}
              {maxFileSizeBytes ? <Text style={styles.metaText}>Maximum size {formatBytes(maxFileSizeBytes)}</Text> : null}
            </View>
          </View>
          {fileError ? <Text style={styles.errorText}>{fileError}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={pickDisabled}
              onPress={() => void chooseFile()}
              style={[styles.secondaryButton, pickDisabled && styles.disabled]}
            >
              {isPicking ? <ActivityIndicator color={COLORS.primary} size="small" /> : <Text style={styles.secondaryButtonText}>{file ? 'Choose another file' : 'Choose CSV file'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={uploadDisabled}
              onPress={() => void startUpload()}
              style={[styles.primaryButton, uploadDisabled && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>Upload</Text>
            </TouchableOpacity>
          </View>
        </View>

        {renderOutcome()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  headerTitle: { color: COLORS.white, flex: 1, fontSize: 20, fontWeight: '700' },
  content: { alignSelf: 'center', gap: 12, maxWidth: 960, padding: 16, paddingBottom: 32, width: '100%' },
  centered: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  centeredText: { color: COLORS.textPrimary, fontSize: 15, textAlign: 'center' },
  panel: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  helpToggle: { alignItems: 'center', flexDirection: 'row', gap: 6, minHeight: 32 },
  helpToggleText: { color: COLORS.primary, flex: 1, fontSize: 14, fontWeight: '600' },
  help: { gap: 6, marginTop: 8 },
  code: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 6,
    color: COLORS.textPrimary,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 12,
    padding: 10,
  },
  helpItem: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },
  fileRow: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  fileInfo: { flex: 1, minWidth: 0 },
  fileName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600' },
  metaText: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  errorText: { color: COLORS.danger, fontSize: 13, marginTop: 8 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end', marginTop: 12 },
  progress: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'center', padding: 16 },
  progressText: { color: COLORS.textPrimary, fontSize: 15 },
  rejected: { gap: 8 },
  hint: { color: COLORS.textSecondary, fontSize: 13, fontStyle: 'italic' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: COLORS.primary, fontSize: 14, fontWeight: '600' },
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
