import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import {
  ARTIFACT_ALLOWED_CONTENT_TYPES,
  ARTIFACT_MAX_SIZE_BYTES,
  DESKTOP_MIN_WIDTH,
} from '../../constants/layout';
import { CONFIG_TYPE } from '../../constants/idCodes';
import ArtifactRow, { ArtifactRowStatus } from '../../components/artifacts/ArtifactRow';
import ConfirmDialog from '../../components/artifacts/ConfirmDialog';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import {
  deleteRideArtifact,
  deleteTourArtifact,
  listRideArtifacts,
  listTourArtifacts,
  presignRideUpload,
  presignTourUpload,
} from '../../services/api/artifactApi';
import { listAppConfigs } from '../../services/api/configApi';
import { listRides } from '../../services/api/rideApi';
import { listTours } from '../../services/api/tourApi';
import { pickArtifactFile, uploadToPresignedUrl, PickedFile } from '../../services/artifacts/artifactUploader';
import { AppConfigItem, ArtifactCategory, ArtifactTypeConfig } from '../../types/config';
import { ArtifactManifestItem } from '../../types/api';
import { Ride, Tour } from '../../types/models';
import { logger } from '../../utils/logger';

const TAG = 'ArtifactsScreen';

type Scope = ArtifactCategory;
type RowStatus = Record<string, ArtifactRowStatus>;
type RowErrors = Record<string, string | undefined>;

interface ArtifactsScreenProps {
  onClose: () => void;
}

interface SelectorProps<T> {
  label: string;
  value: T | null;
  getLabel: (item: T) => string;
  items: T[];
  onChange: (item: T) => void;
  disabled?: boolean;
}

function getFriendlyError(err: unknown): string {
  if (err instanceof ApiError || (err as ApiError)?.name === 'ApiError') {
    const apiError = err as ApiError;
    if (apiError.statusCode === 0) return 'Unable to reach the server. Check your connection and try again.';
    if (apiError.statusCode === 403) return 'You do not have permission to manage artifacts.';
    return apiError.message || 'Request failed. Please try again.';
  }
  if (isNetworkError(err)) return 'Unable to reach the server. Check your connection and try again.';
  return err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
}

function getConfigCategory(item: AppConfigItem): ArtifactCategory | null {
  const config = item.config as ArtifactTypeConfig;
  return config?.category === 'tour' || config?.category === 'ride' ? config.category : null;
}

function getArtifactUploadFile(file: PickedFile, artifactId: string): PickedFile {
  const extensionIndex = file.name.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? file.name.slice(extensionIndex) : '';
  return { ...file, name: `${artifactId}${extension}` };
}

function Selector<T>({ label, value, getLabel, items, onChange, disabled = false }: SelectorProps<T>) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.selectorWrap}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        accessibilityLabel={`Select ${label}`}
        accessibilityRole="button"
        disabled={disabled || items.length === 0}
        onPress={() => setVisible(true)}
        style={[styles.selector, (disabled || items.length === 0) && styles.disabled]}
      >
        <Text style={styles.selectorText}>{value ? getLabel(value) : items.length ? `Select ${label.toLowerCase()}` : 'None available'}</Text>
        <MaterialIcons name="arrow-drop-down" size={22} color={COLORS.textSecondary} />
      </TouchableOpacity>
      <Modal animationType="fade" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <TouchableOpacity activeOpacity={1} onPress={() => setVisible(false)} style={styles.modalOverlay}>
          <View style={styles.optionPanel}>
            <Text style={styles.optionTitle}>{label}</Text>
            {items.map((item) => (
              <TouchableOpacity
                accessibilityRole="button"
                key={getLabel(item)}
                onPress={() => { onChange(item); setVisible(false); }}
                style={styles.option}
              >
                <Text style={styles.optionText}>{getLabel(item)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function ArtifactsScreen({ onClose }: ArtifactsScreenProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const [tours, setTours] = useState<Tour[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [tourTypes, setTourTypes] = useState<AppConfigItem[]>([]);
  const [rideTypes, setRideTypes] = useState<AppConfigItem[]>([]);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [scope, setScope] = useState<Scope>('tour');
  const [manifest, setManifest] = useState<ArtifactManifestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<RowStatus>({});
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const manifestRequestId = useRef(0);

  const configuredTypes = scope === 'tour' ? tourTypes : rideTypes;
  const manifestById = useMemo(() => new Map(manifest.map((item) => [item.artifactId, item])), [manifest]);

  const loadManifest = useCallback(async () => {
    if (!selectedTour || (scope === 'ride' && !selectedRide)) {
      setManifest([]);
      return;
    }
    const requestId = manifestRequestId.current + 1;
    manifestRequestId.current = requestId;
    setIsLoadingManifest(true);
    setError(null);
    try {
      const items = scope === 'tour'
        ? await listTourArtifacts(selectedTour.tourId)
        : await listRideArtifacts(selectedTour.tourId, selectedRide!.rideId);
      if (requestId === manifestRequestId.current) setManifest(items);
    } catch (err) {
      logger.error(TAG, 'loadManifest failed', err);
      if (requestId === manifestRequestId.current) setError(getFriendlyError(err));
    } finally {
      if (requestId === manifestRequestId.current) setIsLoadingManifest(false);
    }
  }, [scope, selectedRide, selectedTour]);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [availableTours, configs] = await Promise.all([
        listTours(),
        listAppConfigs([CONFIG_TYPE.ARTIFACTS]),
      ]);
      const enabledConfigs = configs.filter((item) => item.enabled);
      setTours(availableTours);
      setSelectedTour(availableTours[0] ?? null);
      setTourTypes(enabledConfigs.filter((item) => getConfigCategory(item) === 'tour'));
      setRideTypes(enabledConfigs.filter((item) => getConfigCategory(item) === 'ride'));
    } catch (err) {
      logger.error(TAG, 'loadInitialData failed', err);
      setError(getFriendlyError(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadInitialData(); }, [loadInitialData]);

  useEffect(() => {
    if (!selectedTour) {
      setRides([]);
      setSelectedRide(null);
      return;
    }
    let active = true;
    void listRides(selectedTour.tourId).then((items) => {
      if (active) {
        setRides(items);
        setSelectedRide(items[0] ?? null);
      }
    }).catch((err) => {
      if (active) setError(getFriendlyError(err));
    });
    return () => { active = false; };
  }, [selectedTour]);

  useEffect(() => { void loadManifest(); }, [loadManifest]);

  const refreshManifest = useCallback(async () => {
    await loadManifest();
  }, [loadManifest]);

  const validateFile = (file: PickedFile): string | null => {
    if (file.size > ARTIFACT_MAX_SIZE_BYTES) return 'File exceeds the 50 MB maximum size.';
    if (!(ARTIFACT_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.contentType)) {
      return `File type ${file.contentType} is not allowed.`;
    }
    return null;
  };

  const handleUpload = useCallback(async (artifactId: string) => {
    if (!selectedTour || (scope === 'ride' && !selectedRide)) return;
    setRowStatus((current) => ({ ...current, [artifactId]: 'uploading' }));
    setRowErrors((current) => ({ ...current, [artifactId]: undefined }));
    try {
      const file = await pickArtifactFile([...ARTIFACT_ALLOWED_CONTENT_TYPES]);
      if (!file) return;
      const validationError = validateFile(file);
      if (validationError) throw new Error(validationError);
      const uploadFile = getArtifactUploadFile(file, artifactId);
      logger.debug(TAG, 'Uploading artifact', { artifactId, fileName: uploadFile.name, contentType: uploadFile.contentType, size: uploadFile.size });
      const request = {
        tourId: selectedTour.tourId,
        ...(scope === 'ride' ? { rideId: selectedRide!.rideId } : {}),
        artifactId,
        contentType: uploadFile.contentType,
        fileName: uploadFile.name,
      };
      const response = scope === 'tour'
        ? await presignTourUpload(request)
        : await presignRideUpload(request);
      await uploadToPresignedUrl(response.uploadUrl, uploadFile);
      await refreshManifest();
    } catch (err) {
      logger.error(TAG, 'handleUpload failed', { artifactId, error: err });
      setRowStatus((current) => ({ ...current, [artifactId]: 'error' }));
      setRowErrors((current) => ({ ...current, [artifactId]: getFriendlyError(err) }));
    } finally {
      setRowStatus((current) => ({ ...current, [artifactId]: current[artifactId] === 'uploading' ? 'idle' : current[artifactId] }));
    }
  }, [refreshManifest, scope, selectedRide, selectedTour]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !selectedTour || (scope === 'ride' && !selectedRide)) return;
    setIsDeleting(true);
    try {
      if (scope === 'tour') await deleteTourArtifact(selectedTour.tourId, deleteTarget);
      else await deleteRideArtifact(selectedTour.tourId, selectedRide!.rideId, deleteTarget);
      setDeleteTarget(null);
      await refreshManifest();
    } catch (err) {
      setError(getFriendlyError(err));
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget, refreshManifest, scope, selectedRide, selectedTour]);

  const handleTourChange = (tour: Tour) => {
    setSelectedTour(tour);
    setManifest([]);
    setRowErrors({});
  };

  if (isLoading) {
    return <View style={styles.center}><ActivityIndicator color={COLORS.primary} /><Text style={styles.muted}>Loading artifacts...</Text></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Artifacts</Text>
        <TouchableOpacity accessibilityLabel="Close artifacts" accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.filters}>
          <Selector label="Tour" value={selectedTour} items={tours} getLabel={(tour) => `${tour.name} (${tour.tourId})`} onChange={handleTourChange} />
          <View style={styles.scopeGroup}>
            <Text style={styles.label}>Scope</Text>
            <View style={styles.segmented}>
              {(['tour', 'ride'] as Scope[]).map((item) => (
                <TouchableOpacity key={item} accessibilityRole="button" onPress={() => setScope(item)} style={[styles.segment, scope === item && styles.segmentSelected]}>
                  <Text style={[styles.segmentText, scope === item && styles.segmentTextSelected]}>{item === 'tour' ? 'Tour' : 'Ride'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {scope === 'ride' ? <Selector label="Ride" value={selectedRide} items={rides} getLabel={(ride) => `${ride.name} (${ride.date})`} onChange={(ride) => { setSelectedRide(ride); setManifest([]); }} /> : null}
        </View>
        {error ? <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
        {!tours.length ? <Text style={styles.empty}>No tours available.</Text> : null}
        {tours.length > 0 && configuredTypes.length === 0 ? <Text style={styles.empty}>No enabled artifact types are configured for this scope.</Text> : null}
        {isLoadingManifest ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}
        {isDesktop && configuredTypes.length > 0 ? <View style={styles.tableHeader}><Text style={styles.headerCell}>Artifact</Text><Text style={styles.headerCell}>Title</Text><Text style={styles.headerCell}>Version</Text><Text style={styles.headerCell}>Size</Text><Text style={styles.headerCell}>Uploaded</Text><Text style={styles.headerCell}>Actions</Text></View> : null}
        {configuredTypes.map((config) => {
          const artifact = manifestById.get(config.configId);
          return <ArtifactRow key={config.configId} artifactId={config.configId} title={config.description || config.configId} category={scope} artifact={artifact} status={rowStatus[config.configId]} errorMessage={rowErrors[config.configId]} isDesktop={isDesktop} onUpload={() => void handleUpload(config.configId)} onDelete={() => setDeleteTarget(config.configId)} onPreview={artifact?.downloadUrl ? () => void Linking.openURL(artifact.downloadUrl!) : undefined} />;
        })}
      </ScrollView>
      <ConfirmDialog visible={Boolean(deleteTarget)} title="Delete artifact" message="This will remove the artifact and its metadata. Continue?" isSubmitting={isDeleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDelete()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: COLORS.background, flex: 1 },
  header: { alignItems: 'center', backgroundColor: COLORS.surface, borderBottomColor: COLORS.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  closeButton: { padding: 4 },
  content: { maxWidth: 1280, padding: 16, width: '100%' },
  filters: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  selectorWrap: { minWidth: 220 },
  scopeGroup: { minWidth: 180 },
  label: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  selector: { alignItems: 'center', backgroundColor: COLORS.surface, borderColor: COLORS.border, borderRadius: 6, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 42, paddingHorizontal: 12 },
  selectorText: { color: COLORS.textPrimary, flex: 1, fontSize: 14 },
  disabled: { opacity: 0.6 },
  segmented: { backgroundColor: COLORS.gray[200], borderRadius: 6, flexDirection: 'row', padding: 3 },
  segment: { borderRadius: 4, minWidth: 82, paddingHorizontal: 12, paddingVertical: 9 },
  segmentSelected: { backgroundColor: COLORS.surface },
  segmentText: { color: COLORS.textSecondary, fontSize: 14, textAlign: 'center' },
  segmentTextSelected: { color: COLORS.primary, fontWeight: '700' },
  errorBanner: { backgroundColor: '#FEE2E2', borderRadius: 6, marginBottom: 12, padding: 12 },
  errorText: { color: '#991B1B', fontSize: 14 },
  empty: { color: COLORS.textSecondary, paddingVertical: 28, textAlign: 'center' },
  loader: { marginBottom: 12 },
  tableHeader: { backgroundColor: COLORS.gray[100], flexDirection: 'row', minHeight: 42, paddingHorizontal: 20, paddingVertical: 12 },
  headerCell: { color: COLORS.textSecondary, flex: 1, fontSize: 12, fontWeight: '700' },
  center: { alignItems: 'center', backgroundColor: COLORS.background, flex: 1, justifyContent: 'center' },
  muted: { color: COLORS.textSecondary, marginTop: 10 },
  modalOverlay: { alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.45)', flex: 1, justifyContent: 'center', padding: 24 },
  optionPanel: { backgroundColor: COLORS.surface, borderRadius: 8, maxWidth: 520, padding: 16, width: '100%' },
  optionTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  option: { borderBottomColor: COLORS.border, borderBottomWidth: 1, paddingVertical: 14 },
  optionText: { color: COLORS.textPrimary, fontSize: 15 },
});
