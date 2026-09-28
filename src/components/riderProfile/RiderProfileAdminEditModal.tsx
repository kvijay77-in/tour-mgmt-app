import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ApiError } from '../../services/api/apiClient';
import { updateRiderProfile } from '../../services/api/riderApi';
import { COLORS } from '../../constants/colors';
import { Rider, RiderDetailsData } from '../../types/models';
import { OrderedRiderProfileSection, RiderProfileLovDefinition } from '../../types/riderProfile';
import {
  buildAdminProfileUpdatePayload,
} from '../../utils/riderProfileDefinitionEditor';
import RiderProfileRenderer from './RiderProfileRenderer';
import StatusBanner from '../events/StatusBanner';

interface RiderProfileAdminEditModalProps {
  visible: boolean;
  rider: Rider;
  details: RiderDetailsData;
  sections: OrderedRiderProfileSection[];
  lovsById: Record<string, RiderProfileLovDefinition>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

function isEmptyValue(value: unknown): boolean {
  return value === null
    || value === undefined
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}

function buildInitialValues(details: RiderDetailsData, sections: OrderedRiderProfileSection[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  sections.forEach((section) => {
    section.attributes.forEach((attribute) => {
      values[attribute.configId] = attribute.config.storage.scope === 'CORE'
        ? getPathValue(details.rider as unknown as Record<string, unknown>, attribute.config.storage.path)
        : details.profileAttributes?.[attribute.configId];
    });
  });
  return values;
}

export default function RiderProfileAdminEditModal({
  visible,
  rider,
  details,
  sections,
  lovsById,
  onClose,
  onSaved,
}: RiderProfileAdminEditModalProps) {
  const editableSections = useMemo(
    () => sections
      .map((section) => ({
        ...section,
        attributes: section.attributes.filter((attribute) => attribute.enabled && attribute.config.adminOnly),
      }))
      .filter((section) => section.attributes.length > 0),
    [sections],
  );

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'error' | 'warning' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setValues(buildInitialValues(details, editableSections));
    setBanner(null);
    setIsSaving(false);
  }, [details, editableSections, visible]);

  const flatAttributes = useMemo(
    () => editableSections.flatMap((section) => section.attributes),
    [editableSections],
  );

  const handleSave = async () => {
    if (!rider.profileId || details.definitionsVersion === null || details.definitionsVersion === undefined) {
      setBanner({ kind: 'error', message: 'Rider profile details are incomplete. Reload and try again.' });
      return;
    }

    const missingRequired = flatAttributes.find((attribute) => attribute.config.required && isEmptyValue(values[attribute.configId]));
    if (missingRequired) {
      setBanner({ kind: 'warning', message: `${missingRequired.config.label} is required.` });
      return;
    }

    const payload = buildAdminProfileUpdatePayload({
      definitionsVersion: details.definitionsVersion,
      currentCore: details.rider as unknown as Record<string, unknown>,
      currentAttributes: details.profileAttributes,
      nextValues: values,
      definitions: flatAttributes,
    });

    if (Object.keys(payload).length === 1) {
      onClose();
      return;
    }

    setIsSaving(true);
    setBanner(null);
    try {
      await updateRiderProfile(rider.profileId, payload);
      await onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        setBanner({ kind: error.statusCode === 409 ? 'warning' : 'error', message: error.message });
        if (error.errorCode === 'PROFILE_DEFINITIONS_CHANGED') {
          await onSaved();
        }
      } else {
        setBanner({ kind: 'error', message: 'Failed to save admin-only fields. Please try again.' });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Edit admin fields</Text>
            <Text style={styles.subtitle}>{rider.name} · {rider.riderId}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Close</Text>
          </TouchableOpacity>
        </View>

        {banner ? <StatusBanner kind={banner.kind} message={banner.message} /> : null}

        {editableSections.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No enabled admin-only attributes are available for editing.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            <RiderProfileRenderer
              sections={editableSections}
              values={values}
              lovsById={lovsById}
              mode="edit"
              onChangeValue={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
            />
          </ScrollView>
        )}

        <View style={styles.footer}>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={isSaving || editableSections.length === 0}
            onPress={() => void handleSave()}
            style={[styles.primaryButton, (isSaving || editableSections.length === 0) && styles.disabledButton]}
          >
            {isSaving ? <ActivityIndicator color={COLORS.white} size="small" /> : <Text style={styles.primaryButtonText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    flex: 1,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  content: {
    paddingBottom: 16,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    borderColor: COLORS.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  emptyStateText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
