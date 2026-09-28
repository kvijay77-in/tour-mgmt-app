import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useOffline } from '../../context/OfflineContext';
import { useTour } from '../../context/TourContext';
import { ApiError, isNetworkError } from '../../services/api/apiClient';
import {
  listAdminRiderProfileConfig,
  upsertRiderProfileConfig,
} from '../../services/api/riderProfileConfigApi';
import OfflineBanner from '../../components/common/OfflineBanner';
import EventScreenHeader from '../../components/events/EventScreenHeader';
import StatusBanner from '../../components/events/StatusBanner';
import RiderProfileRenderer from '../../components/riderProfile/RiderProfileRenderer';
import {
  LovItem,
  OrderedRiderProfileSection,
  RiderProfileAttributeDefinition,
  RiderProfileAttributeType,
  RiderProfileGroupField,
  RiderProfileLovDefinition,
  RiderProfileSectionDefinition,
  RiderProfileVisibleWhenOp,
} from '../../types/riderProfile';
import {
  buildRiderProfileConfigSaveRequest,
  mergeLovItems,
  parseLovCsv,
  validateAttributeDefinitionMutation,
} from '../../utils/riderProfileDefinitionEditor';
import {
  moveAttributeDefinition,
  moveOrderedDefinition,
  orderDefinitionsIntoSections,
  recomputeLovItemOrders,
} from '../../utils/riderProfileDefinitions';
import { logger } from '../../utils/logger';

const TAG = 'RiderProfileDefinitions';
const ATTRIBUTE_TYPES: RiderProfileAttributeType[] = [
  'TEXT',
  'TEXTAREA',
  'EMAIL',
  'PHONE',
  'URL',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
  'FILE',
  'IMAGE',
  'GROUP',
];
const HANDLER_OPTIONS = ['', 'PERSONAL_CODE', 'COGNITO_EMAIL', 'PROFILE_PHOTO'] as const;
const VISIBLE_WHEN_OPS: RiderProfileVisibleWhenOp[] = ['EQ', 'NEQ', 'IN', 'NOT_EMPTY'];
const ATTRIBUTE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

interface RiderProfileDefinitionsScreenProps {
  onClose: () => void;
}

type TabKey = 'sections' | 'attributes' | 'lovs';
type EditorMode = 'view' | 'edit' | 'create';
type Banner = { kind: 'error' | 'warning' | 'info'; message: string; retryTab?: TabKey } | null;

interface SelectionState {
  tab: TabKey;
  mode: EditorMode;
  id: string | null;
}

interface SectionFormState {
  configId: string;
  label: string;
  icon: string;
  description: string;
  enabled: boolean;
  version: number | null;
}

interface GroupFieldState {
  key: string;
  label: string;
  type: Exclude<RiderProfileAttributeType, 'GROUP'>;
  required: boolean;
  lovId: string;
  dependsOn: string;
  fallbackToText: boolean;
  placeholder: string;
  helpText: string;
  minLength: string;
  maxLength: string;
  pattern: string;
}

interface AttributeFormState {
  configId: string;
  label: string;
  helpText: string;
  placeholder: string;
  sectionId: string;
  type: RiderProfileAttributeType;
  storageScope: 'ATTRIBUTES' | 'CORE';
  storagePath: string;
  required: boolean;
  adminOnly: boolean;
  sensitive: boolean;
  visibleToAllMgmtUsers: boolean;
  system: boolean;
  enabled: boolean;
  version: number | null;
  lovId: string;
  dependsOn: string;
  fallbackToText: boolean;
  visibleWhenAttribute: string;
  visibleWhenOp: RiderProfileVisibleWhenOp;
  visibleWhenValue: string;
  handler: string;
  minLength: string;
  maxLength: string;
  pattern: string;
  min: string;
  max: string;
  decimals: string;
  unit: string;
  minDate: string;
  maxDate: string;
  minItems: string;
  maxItems: string;
  allowedMimeTypes: string;
  maxFileSizeBytes: string;
  repeatable: boolean;
  groupFields: GroupFieldState[];
}

interface LovFormState {
  configId: string;
  label: string;
  parentLovId: string;
  enabled: boolean;
  version: number | null;
  items: LovItem[];
  csvText: string;
}

function emptySectionForm(): SectionFormState {
  return {
    configId: '',
    label: '',
    icon: '',
    description: '',
    enabled: true,
    version: null,
  };
}

function emptyGroupField(): GroupFieldState {
  return {
    key: '',
    label: '',
    type: 'TEXT',
    required: false,
    lovId: '',
    dependsOn: '',
    fallbackToText: false,
    placeholder: '',
    helpText: '',
    minLength: '',
    maxLength: '',
    pattern: '',
  };
}

function emptyAttributeForm(sectionId: string): AttributeFormState {
  return {
    configId: '',
    label: '',
    helpText: '',
    placeholder: '',
    sectionId,
    type: 'TEXT',
    storageScope: 'ATTRIBUTES',
    storagePath: '',
    required: false,
    adminOnly: false,
    sensitive: false,
    visibleToAllMgmtUsers: false,
    system: false,
    enabled: true,
    version: null,
    lovId: '',
    dependsOn: '',
    fallbackToText: false,
    visibleWhenAttribute: '',
    visibleWhenOp: 'EQ',
    visibleWhenValue: '',
    handler: '',
    minLength: '',
    maxLength: '',
    pattern: '',
    min: '',
    max: '',
    decimals: '',
    unit: '',
    minDate: '',
    maxDate: '',
    minItems: '',
    maxItems: '',
    allowedMimeTypes: '',
    maxFileSizeBytes: '',
    repeatable: false,
    groupFields: [],
  };
}

function emptyLovForm(): LovFormState {
  return {
    configId: '',
    label: '',
    parentLovId: '',
    enabled: true,
    version: null,
    items: [],
    csvText: '',
  };
}

function normalizeNumber(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function confirmAttributeDisable(): boolean {
  if (typeof globalThis.confirm === 'function') {
    return globalThis.confirm('Riders will no longer see this attribute. Stored values are kept and are not deleted.');
  }
  return true;
}

function toSectionDefinition(item: Awaited<ReturnType<typeof listAdminRiderProfileConfig<'RIDER_PROFILE_SECTION'>>>[number]): RiderProfileSectionDefinition {
  return {
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  };
}

function toAttributeDefinition(item: Awaited<ReturnType<typeof listAdminRiderProfileConfig<'RIDER_PROFILE_ATTRIBUTE'>>>[number]): RiderProfileAttributeDefinition {
  return {
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  };
}

function toLovDefinition(item: Awaited<ReturnType<typeof listAdminRiderProfileConfig<'LOV'>>>[number]): RiderProfileLovDefinition {
  return {
    configId: item.configId,
    enabled: item.enabled,
    version: item.version ?? null,
    config: item.config,
  };
}

function toSectionForm(definition: RiderProfileSectionDefinition): SectionFormState {
  return {
    configId: definition.configId,
    label: definition.config.label,
    icon: definition.config.icon ?? '',
    description: definition.config.description ?? '',
    enabled: definition.enabled,
    version: definition.version ?? null,
  };
}

function toGroupFieldState(field: RiderProfileGroupField): GroupFieldState {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    lovId: field.lovId ?? '',
    dependsOn: field.dependsOn ?? '',
    fallbackToText: Boolean(field.fallbackToText),
    placeholder: field.placeholder ?? '',
    helpText: field.helpText ?? '',
    minLength: field.validation?.minLength ? String(field.validation.minLength) : '',
    maxLength: field.validation?.maxLength ? String(field.validation.maxLength) : '',
    pattern: field.validation?.pattern ?? '',
  };
}

function toAttributeForm(definition: RiderProfileAttributeDefinition): AttributeFormState {
  const validation = definition.config.validation ?? {};
  const visibleWhen = definition.config.visibleWhen;
  return {
    configId: definition.configId,
    label: definition.config.label,
    helpText: definition.config.helpText ?? '',
    placeholder: definition.config.placeholder ?? '',
    sectionId: definition.config.sectionId,
    type: definition.config.type,
    storageScope: definition.config.storage.scope,
    storagePath: definition.config.storage.scope === 'CORE' ? definition.config.storage.path : '',
    required: Boolean(definition.config.required),
    adminOnly: Boolean(definition.config.adminOnly),
    sensitive: Boolean(definition.config.sensitive),
    visibleToAllMgmtUsers: Boolean(definition.config.visibleToAllMgmtUsers),
    system: Boolean(definition.config.system),
    enabled: definition.enabled,
    version: definition.version ?? null,
    lovId: definition.config.lovId ?? '',
    dependsOn: definition.config.dependsOn ?? '',
    fallbackToText: Boolean(definition.config.fallbackToText),
    visibleWhenAttribute: visibleWhen?.attribute ?? '',
    visibleWhenOp: visibleWhen?.op ?? 'EQ',
    visibleWhenValue: Array.isArray(visibleWhen?.value)
      ? visibleWhen?.value.join(', ')
      : (visibleWhen?.value ? String(visibleWhen.value) : ''),
    handler: definition.config.handler ?? '',
    minLength: validation.minLength ? String(validation.minLength) : '',
    maxLength: validation.maxLength ? String(validation.maxLength) : '',
    pattern: validation.pattern ?? '',
    min: validation.min ? String(validation.min) : '',
    max: validation.max ? String(validation.max) : '',
    decimals: validation.decimals ? String(validation.decimals) : '',
    unit: validation.unit ?? '',
    minDate: validation.minDate ?? '',
    maxDate: validation.maxDate ?? '',
    minItems: validation.minItems ? String(validation.minItems) : '',
    maxItems: validation.maxItems ? String(validation.maxItems) : '',
    allowedMimeTypes: (validation.allowedMimeTypes ?? []).join(', '),
    maxFileSizeBytes: validation.maxFileSizeBytes ? String(validation.maxFileSizeBytes) : '',
    repeatable: Boolean(definition.config.repeatable),
    groupFields: (definition.config.fields ?? []).map(toGroupFieldState),
  };
}

function toLovForm(definition: RiderProfileLovDefinition): LovFormState {
  return {
    configId: definition.configId,
    label: definition.config.label,
    parentLovId: definition.config.parentLovId ?? '',
    enabled: definition.enabled,
    version: definition.version ?? null,
    items: [...(definition.config.items ?? [])].sort((a, b) => a.order - b.order || a.value.localeCompare(b.value)),
    csvText: '',
  };
}

function buildSectionPayload(form: SectionFormState, previous?: RiderProfileSectionDefinition, fallbackOrder = 1) {
  return {
    configId: form.configId.trim(),
    payload: buildRiderProfileConfigSaveRequest({
      version: previous?.version ?? form.version,
      enabled: form.enabled,
      description: form.description,
      config: {
        label: form.label.trim(),
        icon: form.icon.trim() || undefined,
        order: previous?.config.order ?? fallbackOrder,
        description: form.description.trim() || undefined,
      },
    }),
  };
}

function buildGroupField(field: GroupFieldState): RiderProfileGroupField {
  return {
    key: field.key.trim(),
    label: field.label.trim(),
    type: field.type,
    required: field.required || undefined,
    lovId: field.lovId.trim() || undefined,
    dependsOn: field.dependsOn.trim() || undefined,
    fallbackToText: field.fallbackToText || undefined,
    placeholder: field.placeholder.trim() || undefined,
    helpText: field.helpText.trim() || undefined,
    validation: {
      minLength: normalizeNumber(field.minLength),
      maxLength: normalizeNumber(field.maxLength),
      pattern: field.pattern.trim() || undefined,
    },
  };
}

function buildAttributePayload(form: AttributeFormState, previous?: RiderProfileAttributeDefinition, fallbackOrder = 1) {
  const visibleWhenValue = form.visibleWhenOp === 'IN'
    ? form.visibleWhenValue.split(',').map((item) => item.trim()).filter(Boolean)
    : form.visibleWhenValue.trim();
  const config: RiderProfileAttributeDefinition = {
    configId: form.configId.trim(),
    enabled: form.enabled,
    version: form.version,
    config: {
      label: form.label.trim(),
      helpText: form.helpText.trim() || undefined,
      placeholder: form.placeholder.trim() || undefined,
      sectionId: form.sectionId,
      order: previous?.config.order ?? fallbackOrder,
      type: form.type,
      lovId: form.lovId.trim() || undefined,
      storage: form.storageScope === 'CORE'
        ? { scope: 'CORE', path: form.storagePath.trim() }
        : { scope: 'ATTRIBUTES' },
      required: form.required || undefined,
      adminOnly: form.adminOnly || undefined,
      sensitive: form.sensitive || undefined,
      visibleToAllMgmtUsers: form.visibleToAllMgmtUsers || undefined,
      system: (previous?.config.system ?? form.system) || undefined,
      validation: {
        minLength: normalizeNumber(form.minLength),
        maxLength: normalizeNumber(form.maxLength),
        pattern: form.pattern.trim() || undefined,
        min: normalizeNumber(form.min),
        max: normalizeNumber(form.max),
        decimals: normalizeNumber(form.decimals),
        unit: form.unit.trim() || undefined,
        minDate: form.minDate.trim() || undefined,
        maxDate: form.maxDate.trim() || undefined,
        minItems: normalizeNumber(form.minItems),
        maxItems: normalizeNumber(form.maxItems),
        allowedMimeTypes: form.allowedMimeTypes
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        maxFileSizeBytes: normalizeNumber(form.maxFileSizeBytes),
      },
      visibleWhen: form.visibleWhenAttribute.trim()
        ? {
          attribute: form.visibleWhenAttribute.trim(),
          op: form.visibleWhenOp,
          value: form.visibleWhenOp === 'NOT_EMPTY'
            ? undefined
            : (Array.isArray(visibleWhenValue) ? visibleWhenValue : visibleWhenValue || undefined),
        }
        : undefined,
      dependsOn: form.dependsOn.trim() || undefined,
      fallbackToText: form.fallbackToText || undefined,
      fields: form.type === 'GROUP' ? form.groupFields.map(buildGroupField) : undefined,
      repeatable: form.type === 'GROUP' ? form.repeatable || undefined : undefined,
      maxItems: form.type === 'GROUP' ? normalizeNumber(form.maxItems) : normalizeNumber(form.maxItems),
      handler: form.handler.trim() || undefined,
    },
  };

  if (previous) {
    const guard = validateAttributeDefinitionMutation(previous, config);
    if (guard) {
      throw new Error(guard.message);
    }
  }

  return {
    configId: form.configId.trim(),
    payload: buildRiderProfileConfigSaveRequest({
      version: previous?.version ?? form.version,
      enabled: form.enabled,
      config: config.config,
    }),
  };
}

function buildLovPayload(form: LovFormState, previous?: RiderProfileLovDefinition) {
  return {
    configId: form.configId.trim(),
    payload: buildRiderProfileConfigSaveRequest({
      version: previous?.version ?? form.version,
      enabled: form.enabled,
      config: {
        label: form.label.trim(),
        parentLovId: form.parentLovId.trim() || undefined,
        items: recomputeLovItemOrders(form.items),
      },
    }),
  };
}

function ChipSelector(props: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { label, options, value, onChange, disabled } = props;
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipWrap}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <TouchableOpacity
              key={option || 'none'}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => onChange(option)}
              style={[styles.chip, selected && styles.chipSelected, disabled && styles.disabledButton]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option || 'None'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  editable?: boolean;
}) {
  const { label, value, onChangeText, placeholder, multiline, editable = true } = props;
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={editable}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, multiline && styles.multilineInput, !editable && styles.readOnlyInput]}
        value={value}
      />
    </View>
  );
}

function ToggleField(props: {
  label: string;
  value: boolean;
  onChange?: (value: boolean) => void;
  disabled?: boolean;
}) {
  const { label, value, onChange, disabled } = props;
  return (
    <View style={styles.toggleRow}>
      <Switch accessibilityLabel={label} disabled={disabled} onValueChange={onChange} value={value} />
      <Text style={styles.toggleLabel}>{label}</Text>
    </View>
  );
}

export default function RiderProfileDefinitionsScreen({ onClose }: RiderProfileDefinitionsScreenProps) {
  const { width } = useWindowDimensions();
  const { isOffline } = useOffline();
  const { tour } = useTour();
  const isDesktop = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
  const isReadOnlyMobile = !isDesktop;

  const [sections, setSections] = useState<RiderProfileSectionDefinition[]>([]);
  const [attributes, setAttributes] = useState<RiderProfileAttributeDefinition[]>([]);
  const [lovs, setLovs] = useState<RiderProfileLovDefinition[]>([]);
  const [selected, setSelected] = useState<SelectionState>({ tab: 'sections', mode: 'view', id: null });
  const [sectionForm, setSectionForm] = useState<SectionFormState>(emptySectionForm());
  const [attributeForm, setAttributeForm] = useState<AttributeFormState>(emptyAttributeForm(''));
  const [lovForm, setLovForm] = useState<LovFormState>(emptyLovForm());
  const [banner, setBanner] = useState<Banner>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setBanner(null);
    try {
      const [sectionItems, attributeItems, lovItems] = await Promise.all([
        listAdminRiderProfileConfig('RIDER_PROFILE_SECTION'),
        listAdminRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE'),
        listAdminRiderProfileConfig('LOV'),
      ]);

      const nextSections = sectionItems.map(toSectionDefinition);
      const nextAttributes = attributeItems.map(toAttributeDefinition);
      const nextLovs = lovItems.map(toLovDefinition);
      setSections(nextSections);
      setAttributes(nextAttributes);
      setLovs(nextLovs);

      if (!selected.id) {
        const firstSection = [...nextSections].sort((a, b) => a.config.order - b.config.order)[0];
        if (firstSection) {
          setSelected({ tab: 'sections', mode: 'view', id: firstSection.configId });
          setSectionForm(toSectionForm(firstSection));
        }
      }
    } catch (error) {
      logger.error(TAG, 'Failed to load rider profile definitions', error);
      const message = error instanceof ApiError
        ? error.message
        : isNetworkError(error)
          ? 'Unable to reach the server. Please try again.'
          : 'Failed to load rider profile definitions.';
      setBanner({ kind: 'error', message });
    } finally {
      setIsLoading(false);
    }
  }, [selected.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const orderedSections = useMemo(() => orderDefinitionsIntoSections(sections, attributes), [sections, attributes]);
  const lovsById = useMemo(() => Object.fromEntries(lovs.map((lov) => [lov.configId, lov])), [lovs]);
  const selectedAttribute = useMemo(() => attributes.find((item) => item.configId === selected.id) ?? null, [attributes, selected.id]);

  const previewSections = useMemo<OrderedRiderProfileSection[]>(() => {
    if (selected.tab !== 'attributes' || !selected.id) return orderedSections;
    if (selected.mode === 'create' || selected.mode === 'edit') {
      try {
        const payload = buildAttributePayload(attributeForm, selectedAttribute ?? undefined);
        const nextAttributes = selected.mode === 'create'
          ? [...attributes, { configId: payload.configId, enabled: payload.payload.enabled, version: attributeForm.version, config: payload.payload.config }]
          : attributes.map((attribute) => (attribute.configId === payload.configId
            ? { configId: payload.configId, enabled: payload.payload.enabled, version: attributeForm.version, config: payload.payload.config }
            : attribute));
        return orderDefinitionsIntoSections(sections, nextAttributes);
      } catch {
        return orderedSections;
      }
    }
    return orderedSections;
  }, [attributeForm, attributes, orderedSections, sections, selected.id, selected.mode, selected.tab, selectedAttribute]);

  const previewValues = useMemo<Record<string, unknown>>(() => {
    const values: Record<string, unknown> = {};
    previewSections.forEach((section) => {
      section.attributes.forEach((attribute) => {
        values[attribute.configId] = '';
      });
    });
    return values;
  }, [previewSections]);

  const startCreate = (tab: TabKey) => {
    setBanner(null);
    setSelected({ tab, mode: isReadOnlyMobile ? 'view' : 'create', id: null });
    if (tab === 'sections') setSectionForm(emptySectionForm());
    if (tab === 'attributes') setAttributeForm(emptyAttributeForm(sections[0]?.configId ?? ''));
    if (tab === 'lovs') setLovForm(emptyLovForm());
  };

  const selectSection = (item: RiderProfileSectionDefinition, mode: EditorMode = 'view') => {
    setSelected({ tab: 'sections', mode: isReadOnlyMobile ? 'view' : mode, id: item.configId });
    setSectionForm(toSectionForm(item));
  };

  const selectAttribute = (item: RiderProfileAttributeDefinition, mode: EditorMode = 'view') => {
    setSelected({ tab: 'attributes', mode: isReadOnlyMobile ? 'view' : mode, id: item.configId });
    setAttributeForm(toAttributeForm(item));
  };

  const selectLov = (item: RiderProfileLovDefinition, mode: EditorMode = 'view') => {
    setSelected({ tab: 'lovs', mode: isReadOnlyMobile ? 'view' : mode, id: item.configId });
    setLovForm(toLovForm(item));
  };

  const reloadTab = async (tab: TabKey) => {
    try {
      if (tab === 'sections') {
        setSections((await listAdminRiderProfileConfig('RIDER_PROFILE_SECTION')).map(toSectionDefinition));
      } else if (tab === 'attributes') {
        setAttributes((await listAdminRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE')).map(toAttributeDefinition));
      } else {
        setLovs((await listAdminRiderProfileConfig('LOV')).map(toLovDefinition));
      }
    } catch (error) {
      logger.warn(TAG, 'Failed to reload tab after conflict', error);
    }
  };

  const saveCurrent = async () => {
    if (isReadOnlyMobile || isOffline) return;
    setIsSaving(true);
    setBanner(null);
    try {
      if (selected.tab === 'sections') {
        if (!sectionForm.configId.trim() || !sectionForm.label.trim()) {
          setBanner({ kind: 'warning', message: 'Section id and label are required.' });
          return;
        }
        const previous = sections.find((item) => item.configId === sectionForm.configId);
        const request = buildSectionPayload(sectionForm, previous, sections.length + 1);
        await upsertRiderProfileConfig('RIDER_PROFILE_SECTION', request.configId, request.payload);
      } else if (selected.tab === 'attributes') {
        if (!ATTRIBUTE_KEY_PATTERN.test(attributeForm.configId.trim())) {
          setBanner({ kind: 'warning', message: 'Attribute key must use camelCase letters and digits.' });
          return;
        }
        if (!attributeForm.label.trim() || !attributeForm.sectionId) {
          setBanner({ kind: 'warning', message: 'Attribute key, label and section are required.' });
          return;
        }
        const previous = attributes.find((item) => item.configId === attributeForm.configId);
        if (previous?.enabled && !attributeForm.enabled && !previous.config.system && !confirmAttributeDisable()) {
          return;
        }
        const nextOrder = attributes.filter((item) => item.config.sectionId === attributeForm.sectionId).length + 1;
        const request = buildAttributePayload(attributeForm, previous, nextOrder);
        await upsertRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE', request.configId, request.payload);
      } else {
        if (!lovForm.configId.trim() || !lovForm.label.trim()) {
          setBanner({ kind: 'warning', message: 'LOV id and label are required.' });
          return;
        }
        const previous = lovs.find((item) => item.configId === lovForm.configId);
        const request = buildLovPayload(lovForm, previous);
        await upsertRiderProfileConfig('LOV', request.configId, request.payload);
      }

      await load();
      if (selected.tab === 'sections') {
        const reloaded = await listAdminRiderProfileConfig('RIDER_PROFILE_SECTION');
        const item = reloaded.find((entry) => entry.configId === sectionForm.configId);
        if (item) selectSection(toSectionDefinition(item), 'view');
      } else if (selected.tab === 'attributes') {
        const reloaded = await listAdminRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE');
        const item = reloaded.find((entry) => entry.configId === attributeForm.configId);
        if (item) selectAttribute(toAttributeDefinition(item), 'view');
      } else {
        const reloaded = await listAdminRiderProfileConfig('LOV');
        const item = reloaded.find((entry) => entry.configId === lovForm.configId);
        if (item) selectLov(toLovDefinition(item), 'view');
      }
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === 'CONFIG_VERSION_CONFLICT') {
        await reloadTab(selected.tab);
        setBanner({
          kind: 'warning',
          message: error.message,
          retryTab: selected.tab,
        });
      } else {
        setBanner({
          kind: error instanceof ApiError ? 'error' : 'warning',
          message: error instanceof Error ? error.message : 'Save failed.',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const saveDefinitions = async (tab: TabKey, nextItems: RiderProfileSectionDefinition[] | RiderProfileAttributeDefinition[]) => {
    setIsSaving(true);
    try {
      if (tab === 'sections') {
        await Promise.all(
          (nextItems as RiderProfileSectionDefinition[]).map((item) =>
            upsertRiderProfileConfig('RIDER_PROFILE_SECTION', item.configId, buildRiderProfileConfigSaveRequest({
              version: item.version,
              enabled: item.enabled,
              description: item.config.description,
              config: item.config,
            }))),
        );
      } else {
        await Promise.all(
          (nextItems as RiderProfileAttributeDefinition[]).map((item) =>
            upsertRiderProfileConfig('RIDER_PROFILE_ATTRIBUTE', item.configId, buildRiderProfileConfigSaveRequest({
              version: item.version,
              enabled: item.enabled,
              config: item.config,
            }))),
        );
      }
      await load();
    } catch (error) {
      setBanner({ kind: 'error', message: error instanceof Error ? error.message : 'Reordering failed.' });
    } finally {
      setIsSaving(false);
    }
  };

  const moveSection = async (configId: string, direction: 'up' | 'down') => {
    const next = moveOrderedDefinition(sections, configId, direction);
    setSections(next);
    await saveDefinitions('sections', next);
  };

  const moveAttribute = async (configId: string, targetSectionId: string, direction: 'up' | 'down') => {
    const next = moveAttributeDefinition(attributes, configId, targetSectionId, direction);
    setAttributes(next);
    await saveDefinitions('attributes', next);
  };

  const applyCsvImport = (mode: 'merge' | 'replace') => {
    const parsed = parseLovCsv(lovForm.csvText);
    if (parsed.errors.length > 0) {
      setBanner({ kind: 'warning', message: parsed.errors.join('\n') });
      return;
    }
    setLovForm((current) => ({
      ...current,
      items: recomputeLovItemOrders(mergeLovItems(current.items, parsed.items, mode)),
    }));
    setBanner({ kind: 'info', message: `Imported ${parsed.items.length} LOV rows (${mode}).` });
  };

  const sectionCards = [...sections].sort((a, b) => a.config.order - b.config.order || a.configId.localeCompare(b.configId));
  const lovCards = [...lovs].sort((a, b) => a.config.label.localeCompare(b.config.label));
  const orderedAttributeSections = orderDefinitionsIntoSections(sections.map((section) => ({ ...section, enabled: true })), attributes);
  const switchTab = (tab: TabKey) => {
    if (tab === 'sections') {
      if (sectionCards[0]) selectSection(sectionCards[0]);
      else setSelected({ tab, mode: 'view', id: null });
      return;
    }
    if (tab === 'attributes') {
      const firstAttribute = orderedAttributeSections.flatMap((section) => section.attributes)[0];
      if (firstAttribute) selectAttribute(firstAttribute);
      else setSelected({ tab, mode: 'view', id: null });
      return;
    }
    if (lovCards[0]) {
      selectLov(lovCards[0]);
      return;
    }
    setSelected({ tab, mode: 'view', id: null });
  };

  return (
    <View style={styles.container}>
      <EventScreenHeader
        title="Rider profile definitions"
        subtitle={tour?.name}
        onBack={onClose}
        right={!isReadOnlyMobile ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isOffline}
            onPress={() => startCreate(selected.tab)}
            style={[styles.primaryHeaderButton, isOffline && styles.disabledButton]}
          >
            <MaterialIcons name="add" size={18} color={COLORS.white} />
            <Text style={styles.primaryHeaderButtonText}>New</Text>
          </TouchableOpacity>
        ) : undefined}
      />

      <ScrollView contentContainerStyle={styles.screenContent}>
        <OfflineBanner />
        {isReadOnlyMobile ? (
          <StatusBanner kind="info" message="Tip: for best experience use web. Mobile fallback supports read-only access." />
        ) : null}
        {isOffline ? (
          <StatusBanner kind="warning" message="Rider profile definitions require a connection to edit." />
        ) : null}
        {banner ? (
          <StatusBanner
            kind={banner.kind}
            message={banner.message}
            primaryAction={banner.retryTab ? { label: 'Retry', onPress: () => void reloadTab(banner.retryTab!) } : undefined}
            onDismiss={() => setBanner(null)}
          />
        ) : null}

        {isLoading ? <ActivityIndicator color={COLORS.primary} style={styles.loader} /> : null}

        {!isLoading ? (
          <View style={[styles.contentWrap, isDesktop && styles.desktopWrap]}>
            <View style={[styles.leftPane, isDesktop && styles.desktopPane]}>
              <View style={styles.tabRow}>
                {(['sections', 'attributes', 'lovs'] as TabKey[]).map((tab) => {
                  const selectedTab = selected.tab === tab;
                  return (
                    <TouchableOpacity
                      key={tab}
                      accessibilityRole="button"
                      onPress={() => switchTab(tab)}
                      style={[styles.tabButton, selectedTab && styles.tabButtonSelected]}
                    >
                      <Text style={[styles.tabButtonText, selectedTab && styles.tabButtonTextSelected]}>
                        {tab === 'sections' ? 'Sections' : tab === 'attributes' ? 'Attributes' : 'Lists of values'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {selected.tab === 'sections' ? (
                <View style={styles.listBlock}>
                  {sectionCards.map((item) => {
                    const attributeCount = attributes.filter((attribute) => attribute.config.sectionId === item.configId).length;
                    return (
                      <TouchableOpacity key={item.configId} onPress={() => selectSection(item)} style={styles.card}>
                        <View style={styles.cardHeader}>
                          <Text style={styles.cardTitle}>{item.config.label}</Text>
                          <Text style={styles.cardStatus}>{item.enabled ? 'Enabled' : 'Disabled'}</Text>
                        </View>
                        <Text style={styles.cardMeta}>{item.configId}</Text>
                        <Text style={styles.cardMeta}>{item.config.icon || 'No icon'}</Text>
                        <Text style={styles.cardMeta}>{attributeCount} attributes</Text>
                        {isDesktop ? (
                          <View style={styles.actionRow}>
                            <TouchableOpacity accessibilityRole="button" onPress={() => selectSection(item, 'edit')} style={styles.secondaryAction}>
                              <Text style={styles.secondaryActionText}>Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity accessibilityRole="button" onPress={() => void moveSection(item.configId, 'up')} style={styles.secondaryAction}>
                              <Text style={styles.secondaryActionText}>Up</Text>
                            </TouchableOpacity>
                            <TouchableOpacity accessibilityRole="button" onPress={() => void moveSection(item.configId, 'down')} style={styles.secondaryAction}>
                              <Text style={styles.secondaryActionText}>Down</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}

              {selected.tab === 'attributes' ? (
                <View style={styles.listBlock}>
                  {orderedAttributeSections.map((section) => (
                    <View key={section.sectionId} style={styles.sectionGroup}>
                      <Text style={styles.sectionGroupTitle}>{section.section.config.label}</Text>
                      {section.attributes.map((item) => (
                        <TouchableOpacity key={item.configId} onPress={() => selectAttribute(item)} style={styles.card}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle}>{item.config.label}</Text>
                            <Text style={styles.cardStatus}>{item.enabled ? 'Enabled' : 'Disabled'}</Text>
                          </View>
                          <Text style={styles.cardMeta}>{item.configId}</Text>
                          <View style={styles.badgeWrap}>
                            {item.config.system ? <Text style={styles.badge}>System</Text> : null}
                            {item.config.required ? <Text style={styles.badge}>Required</Text> : null}
                            {item.config.adminOnly ? <Text style={styles.badge}>Admin-only</Text> : null}
                            {item.config.sensitive ? <Text style={styles.badge}>Sensitive</Text> : null}
                            {item.config.visibleToAllMgmtUsers ? <Text style={styles.badge}>Visible-to-all</Text> : null}
                          </View>
                          {isDesktop ? (
                            <View style={styles.actionRow}>
                              <TouchableOpacity accessibilityRole="button" onPress={() => selectAttribute(item, 'edit')} style={styles.secondaryAction}>
                                <Text style={styles.secondaryActionText}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity accessibilityRole="button" onPress={() => void moveAttribute(item.configId, item.config.sectionId, 'up')} style={styles.secondaryAction}>
                                <Text style={styles.secondaryActionText}>Up</Text>
                              </TouchableOpacity>
                              <TouchableOpacity accessibilityRole="button" onPress={() => void moveAttribute(item.configId, item.config.sectionId, 'down')} style={styles.secondaryAction}>
                                <Text style={styles.secondaryActionText}>Down</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}

              {selected.tab === 'lovs' ? (
                <View style={styles.listBlock}>
                  {lovCards.map((item) => (
                    <TouchableOpacity key={item.configId} onPress={() => selectLov(item)} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>{item.config.label}</Text>
                        <Text style={styles.cardStatus}>{item.enabled ? 'Enabled' : 'Disabled'}</Text>
                      </View>
                      <Text style={styles.cardMeta}>{item.configId}</Text>
                      <Text style={styles.cardMeta}>{item.config.items.length} items</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={[styles.rightPane, isDesktop && styles.desktopPane]}>
              {selected.tab === 'sections' ? (
                <View style={styles.editorCard}>
                  <Text style={styles.editorTitle}>Section</Text>
                  <TextField
                    label="Id"
                    value={sectionForm.configId}
                    editable={selected.mode === 'create' && !isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setSectionForm((current) => ({ ...current, configId: value }))}
                  />
                  <TextField
                    label="Label"
                    value={sectionForm.label}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setSectionForm((current) => ({ ...current, label: value }))}
                  />
                  <TextField
                    label="Icon"
                    value={sectionForm.icon}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setSectionForm((current) => ({ ...current, icon: value }))}
                  />
                  <TextField
                    label="Description"
                    value={sectionForm.description}
                    editable={!isReadOnlyMobile && !isOffline}
                    multiline
                    onChangeText={(value) => setSectionForm((current) => ({ ...current, description: value }))}
                  />
                  <ToggleField
                    label="Enabled"
                    value={sectionForm.enabled}
                    disabled={isReadOnlyMobile || isOffline}
                    onChange={(value) => setSectionForm((current) => ({ ...current, enabled: value }))}
                  />
                </View>
              ) : null}

              {selected.tab === 'attributes' ? (
                <View style={styles.editorCard}>
                  <Text style={styles.editorTitle}>Attribute</Text>
                  <TextField
                    label="Key"
                    value={attributeForm.configId}
                    editable={selected.mode === 'create' && !isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, configId: value }))}
                  />
                  <TextField
                    label="Label"
                    value={attributeForm.label}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, label: value }))}
                  />
                  <TextField
                    label="Help text"
                    value={attributeForm.helpText}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, helpText: value }))}
                  />
                  <TextField
                    label="Placeholder"
                    value={attributeForm.placeholder}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, placeholder: value }))}
                  />
                  <ChipSelector
                    label="Type"
                    options={ATTRIBUTE_TYPES}
                    value={attributeForm.type}
                    disabled={selected.mode !== 'create' || isReadOnlyMobile || isOffline}
                    onChange={(value) => setAttributeForm((current) => ({ ...current, type: value as RiderProfileAttributeType }))}
                  />
                  <ChipSelector
                    label="Storage"
                    options={['ATTRIBUTES', 'CORE']}
                    value={attributeForm.storageScope}
                    disabled={attributeForm.system || isReadOnlyMobile || isOffline}
                    onChange={(value) => setAttributeForm((current) => ({ ...current, storageScope: value as 'ATTRIBUTES' | 'CORE' }))}
                  />
                  {attributeForm.storageScope === 'CORE' ? (
                    <TextField
                      label="Core path"
                      value={attributeForm.storagePath}
                      editable={!attributeForm.system && !isReadOnlyMobile && !isOffline}
                      onChangeText={(value) => setAttributeForm((current) => ({ ...current, storagePath: value }))}
                    />
                  ) : null}
                  <ChipSelector
                    label="Section"
                    options={sectionCards.map((item) => item.configId)}
                    value={attributeForm.sectionId}
                    disabled={isReadOnlyMobile || isOffline}
                    onChange={(value) => setAttributeForm((current) => ({ ...current, sectionId: value }))}
                  />
                  <TextField
                    label="LOV id"
                    value={attributeForm.lovId}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, lovId: value }))}
                    placeholder="Optional"
                  />
                  <TextField
                    label="Depends on"
                    value={attributeForm.dependsOn}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, dependsOn: value }))}
                    placeholder="Optional attribute key"
                  />
                  <TextField
                    label="Visible when attribute"
                    value={attributeForm.visibleWhenAttribute}
                    editable={!isReadOnlyMobile && !isOffline}
                    onChangeText={(value) => setAttributeForm((current) => ({ ...current, visibleWhenAttribute: value }))}
                  />
                  <ChipSelector
                    label="Visible when operator"
                    options={VISIBLE_WHEN_OPS}
                    value={attributeForm.visibleWhenOp}
                    disabled={isReadOnlyMobile || isOffline}
                    onChange={(value) => setAttributeForm((current) => ({ ...current, visibleWhenOp: value as RiderProfileVisibleWhenOp }))}
                  />
                  {attributeForm.visibleWhenOp !== 'NOT_EMPTY' ? (
                    <TextField
                      label="Visible when value"
                      value={attributeForm.visibleWhenValue}
                      editable={!isReadOnlyMobile && !isOffline}
                      onChangeText={(value) => setAttributeForm((current) => ({ ...current, visibleWhenValue: value }))}
                    />
                  ) : null}
                  <ChipSelector
                    label="Handler"
                    options={[...HANDLER_OPTIONS]}
                    value={attributeForm.handler}
                    disabled={isReadOnlyMobile || isOffline}
                    onChange={(value) => setAttributeForm((current) => ({ ...current, handler: value }))}
                  />
                  <View style={styles.toggleBlock}>
                    <ToggleField label="Enabled" value={attributeForm.enabled} disabled={attributeForm.system || isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, enabled: value }))} />
                    <ToggleField label="Required" value={attributeForm.required} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, required: value }))} />
                    <ToggleField label="Admin-only" value={attributeForm.adminOnly} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, adminOnly: value }))} />
                    <ToggleField label="Sensitive" value={attributeForm.sensitive} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, sensitive: value }))} />
                    <ToggleField label="Visible to all management users" value={attributeForm.visibleToAllMgmtUsers} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, visibleToAllMgmtUsers: value }))} />
                    <ToggleField label="Fallback to text" value={attributeForm.fallbackToText} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, fallbackToText: value }))} />
                    {attributeForm.type === 'GROUP' ? (
                      <ToggleField label="Repeatable" value={attributeForm.repeatable} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({ ...current, repeatable: value }))} />
                    ) : null}
                  </View>

                  {['TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'URL'].includes(attributeForm.type) ? (
                    <>
                      <TextField label="Min length" value={attributeForm.minLength} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, minLength: value }))} />
                      <TextField label="Max length" value={attributeForm.maxLength} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, maxLength: value }))} />
                      <TextField label="Pattern" value={attributeForm.pattern} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, pattern: value }))} />
                    </>
                  ) : null}
                  {attributeForm.type === 'NUMBER' ? (
                    <>
                      <TextField label="Min" value={attributeForm.min} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, min: value }))} />
                      <TextField label="Max" value={attributeForm.max} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, max: value }))} />
                      <TextField label="Decimals" value={attributeForm.decimals} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, decimals: value }))} />
                      <TextField label="Unit" value={attributeForm.unit} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, unit: value }))} />
                    </>
                  ) : null}
                  {attributeForm.type === 'DATE' ? (
                    <>
                      <TextField label="Min date" value={attributeForm.minDate} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, minDate: value }))} />
                      <TextField label="Max date" value={attributeForm.maxDate} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, maxDate: value }))} />
                    </>
                  ) : null}
                  {['MULTI_SELECT', 'GROUP'].includes(attributeForm.type) ? (
                    <>
                      <TextField label="Min items" value={attributeForm.minItems} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, minItems: value }))} />
                      <TextField label="Max items" value={attributeForm.maxItems} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, maxItems: value }))} />
                    </>
                  ) : null}
                  {['FILE', 'IMAGE'].includes(attributeForm.type) ? (
                    <>
                      <TextField label="Allowed MIME types" value={attributeForm.allowedMimeTypes} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, allowedMimeTypes: value }))} />
                      <TextField label="Max file size bytes" value={attributeForm.maxFileSizeBytes} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({ ...current, maxFileSizeBytes: value }))} />
                    </>
                  ) : null}

                  {attributeForm.type === 'GROUP' ? (
                    <View style={styles.groupEditor}>
                      <Text style={styles.fieldLabel}>Sub-fields</Text>
                      {attributeForm.groupFields.map((field, index) => (
                        <View key={`${field.key}-${index}`} style={styles.groupFieldCard}>
                          <TextField label="Key" value={field.key} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({
                            ...current,
                            groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, key: value } : entry),
                          }))} />
                          <TextField label="Label" value={field.label} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({
                            ...current,
                            groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, label: value } : entry),
                          }))} />
                          <ChipSelector label="Type" options={ATTRIBUTE_TYPES.filter((type) => type !== 'GROUP')} value={field.type} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({
                            ...current,
                            groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, type: value as Exclude<RiderProfileAttributeType, 'GROUP'> } : entry),
                          }))} />
                          <TextField label="LOV id" value={field.lovId} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({
                            ...current,
                            groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, lovId: value } : entry),
                          }))} />
                          <TextField label="Depends on" value={field.dependsOn} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setAttributeForm((current) => ({
                            ...current,
                            groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, dependsOn: value } : entry),
                          }))} />
                          <View style={styles.toggleBlock}>
                            <ToggleField label="Required" value={field.required} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({
                              ...current,
                              groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, required: value } : entry),
                            }))} />
                            <ToggleField label="Fallback to text" value={field.fallbackToText} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setAttributeForm((current) => ({
                              ...current,
                              groupFields: current.groupFields.map((entry, entryIndex) => entryIndex === index ? { ...entry, fallbackToText: value } : entry),
                            }))} />
                          </View>
                          <TouchableOpacity
                            accessibilityRole="button"
                            disabled={isReadOnlyMobile || isOffline}
                            onPress={() => setAttributeForm((current) => ({
                              ...current,
                              groupFields: current.groupFields.filter((_, entryIndex) => entryIndex !== index),
                            }))}
                            style={styles.dangerAction}
                          >
                            <Text style={styles.dangerActionText}>Remove sub-field</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {!isReadOnlyMobile ? (
                        <TouchableOpacity accessibilityRole="button" disabled={isOffline} onPress={() => setAttributeForm((current) => ({ ...current, groupFields: [...current.groupFields, emptyGroupField()] }))} style={styles.secondaryAction}>
                          <Text style={styles.secondaryActionText}>Add sub-field</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {selected.tab === 'lovs' ? (
                <View style={styles.editorCard}>
                  <Text style={styles.editorTitle}>List of values</Text>
                  <TextField label="Id" value={lovForm.configId} editable={selected.mode === 'create' && !isReadOnlyMobile && !isOffline} onChangeText={(value) => setLovForm((current) => ({ ...current, configId: value }))} />
                  <TextField label="Label" value={lovForm.label} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setLovForm((current) => ({ ...current, label: value }))} />
                  <TextField label="Parent LOV id" value={lovForm.parentLovId} editable={!isReadOnlyMobile && !isOffline} onChangeText={(value) => setLovForm((current) => ({ ...current, parentLovId: value }))} />
                  <ToggleField label="Enabled" value={lovForm.enabled} disabled={isReadOnlyMobile || isOffline} onChange={(value) => setLovForm((current) => ({ ...current, enabled: value }))} />

                  <Text style={styles.fieldLabel}>Items</Text>
                  {lovForm.items.map((item, index) => (
                    <View key={`${item.value}-${index}`} style={styles.lovItemRow}>
                      <Text style={styles.cardTitle}>{item.label}</Text>
                      <Text style={styles.cardMeta}>{item.value}</Text>
                      <Text style={styles.cardMeta}>Order {item.order} · Parent {item.parent || '—'}</Text>
                      <Text style={styles.cardMeta}>Meta: {item.meta ? Object.entries(item.meta).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '—'}</Text>
                      {!isReadOnlyMobile ? (
                        <View style={styles.actionRow}>
                          <TouchableOpacity accessibilityRole="button" disabled={isOffline} onPress={() => setLovForm((current) => ({
                            ...current,
                            items: recomputeLovItemOrders(current.items.map((entry, entryIndex) => entryIndex === index ? { ...entry, enabled: !(entry.enabled !== false) } : entry)),
                          }))} style={styles.secondaryAction}>
                            <Text style={styles.secondaryActionText}>{item.enabled === false ? 'Enable' : 'Disable'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" disabled={isOffline || index === 0} onPress={() => setLovForm((current) => {
                            const next = [...current.items];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            return { ...current, items: recomputeLovItemOrders(next) };
                          })} style={styles.secondaryAction}>
                            <Text style={styles.secondaryActionText}>Up</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" disabled={isOffline || index === lovForm.items.length - 1} onPress={() => setLovForm((current) => {
                            const next = [...current.items];
                            [next[index + 1], next[index]] = [next[index], next[index + 1]];
                            return { ...current, items: recomputeLovItemOrders(next) };
                          })} style={styles.secondaryAction}>
                            <Text style={styles.secondaryActionText}>Down</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  ))}

                  {!isReadOnlyMobile ? (
                    <>
                      <TouchableOpacity accessibilityRole="button" disabled={isOffline} onPress={() => setLovForm((current) => ({
                        ...current,
                        items: [...current.items, { value: `value${current.items.length + 1}`, label: `Label ${current.items.length + 1}`, order: current.items.length + 1, enabled: true }],
                      }))} style={styles.secondaryAction}>
                        <Text style={styles.secondaryActionText}>Add item</Text>
                      </TouchableOpacity>
                      <TextField label="CSV import" value={lovForm.csvText} editable={!isOffline} multiline onChangeText={(value) => setLovForm((current) => ({ ...current, csvText: value }))} placeholder="value,label,order,parent" />
                      <View style={styles.actionRow}>
                        <TouchableOpacity accessibilityRole="button" disabled={isOffline} onPress={() => applyCsvImport('merge')} style={styles.secondaryAction}>
                          <Text style={styles.secondaryActionText}>Preview / Merge</Text>
                        </TouchableOpacity>
                        <TouchableOpacity accessibilityRole="button" disabled={isOffline} onPress={() => applyCsvImport('replace')} style={styles.secondaryAction}>
                          <Text style={styles.secondaryActionText}>Preview / Replace</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.editorCard}>
                <Text style={styles.editorTitle}>Preview</Text>
                <RiderProfileRenderer
                  sections={previewSections}
                  values={previewValues}
                  lovsById={lovsById}
                />
              </View>

              {!isReadOnlyMobile ? (
                <View style={styles.footerRow}>
                  <TouchableOpacity accessibilityRole="button" disabled={isOffline || isSaving} onPress={() => void saveCurrent()} style={[styles.primarySaveButton, (isOffline || isSaving) && styles.disabledButton]}>
                    {isSaving ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primarySaveButtonText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
  },
  screenContent: {
    padding: 16,
  },
  loader: {
    marginVertical: 32,
  },
  contentWrap: {
    gap: 16,
  },
  desktopWrap: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  leftPane: {
    gap: 12,
    width: '100%',
  },
  rightPane: {
    gap: 12,
    width: '100%',
  },
  desktopPane: {
    flex: 1,
    minWidth: 0,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tabButton: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tabButtonSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  tabButtonText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  tabButtonTextSelected: {
    color: COLORS.white,
  },
  listBlock: {
    gap: 12,
  },
  sectionGroup: {
    gap: 8,
  },
  sectionGroupTitle: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  cardStatus: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  cardMeta: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  badgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  badge: {
    backgroundColor: COLORS.gray[200],
    borderRadius: 10,
    color: COLORS.textSecondary,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  secondaryAction: {
    borderColor: COLORS.primary,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryActionText: {
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  dangerAction: {
    borderColor: COLORS.danger,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dangerActionText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  editorCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  editorTitle: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  readOnlyInput: {
    backgroundColor: COLORS.gray[100],
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: COLORS.white,
  },
  toggleBlock: {
    gap: 6,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  toggleLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  primarySaveButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 120,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primarySaveButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryHeaderButton: {
    alignItems: 'center',
    borderColor: COLORS.white,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  primaryHeaderButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
  },
  groupEditor: {
    gap: 8,
  },
  groupFieldCard: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  lovItemRow: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
});
