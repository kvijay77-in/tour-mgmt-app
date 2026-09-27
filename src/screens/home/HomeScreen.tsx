/**
 * Home hub — group-aware landing screen listing the modules the user can
 * reach (see src/navigation/modules.ts). A user with exactly one module is
 * sent straight to it.
 *
 * See docs/SolutionDesign.md § Navigation Structure.
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS } from '../../constants/colors';
import { DESKTOP_MIN_WIDTH } from '../../constants/layout';
import { useAuth } from '../../context/AuthContext';
import { useSyncStatus } from '../../context/SyncStatusContext';
import { useTour } from '../../context/TourContext';
import { loadOrgConfig } from '../../services/config/orgConfigService';
import { AppStackParamList } from '../../types/navigation';
import { logger } from '../../utils/logger';
import {
  VisibleModuleEntry,
  navigateToModuleAction,
  resetToModuleAction,
  useVisibleModules,
} from '../../navigation/modules';

const TAG = 'HomeScreen';

interface EntryGroup {
  key: string;
  label?: string;
  entries: VisibleModuleEntry[];
}

function groupEntries(entries: VisibleModuleEntry[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.label === entry.group) {
      last.entries.push(entry);
    } else {
      groups.push({ key: entry.id, label: entry.group, entries: [entry] });
    }
  }
  return groups;
}

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { requestLogout } = useSyncStatus();
  const { tour } = useTour();
  const { sections, entries } = useVisibleModules();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  const isDesktop = width >= DESKTOP_MIN_WIDTH;
  const singleEntry = entries.length === 1 ? entries[0] : null;

  useEffect(() => {
    if (singleEntry) {
      navigation.dispatch(resetToModuleAction(singleEntry.target));
    }
  }, [navigation, singleEntry]);

  useEffect(() => {
    let active = true;
    loadOrgConfig()
      .then((config) => {
        if (active) setOrgName(config?.orgName ?? null);
      })
      .catch((err) => logger.warn(TAG, 'Unable to load org config', err));
    return () => {
      active = false;
    };
  }, []);

  if (singleEntry) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const openEntry = (entry: VisibleModuleEntry) => {
    navigation.dispatch(navigateToModuleAction(entry.target));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>{tour?.name ?? 'Tour Management'}</Text>
          {orgName && <Text style={styles.headerSubtitle} numberOfLines={1}>{orgName}</Text>}
        </View>
        <TouchableOpacity
          style={styles.accountButton}
          onPress={() => setIsAccountMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open account menu"
        >
          <MaterialIcons name="account-circle" size={28} color={COLORS.white} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {sections.length === 0 && (
          <Text style={styles.emptyText}>No modules are available for your role.</Text>
        )}

        {sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {groupEntries(section.entries).map((group) => (
              <View key={group.key}>
                {group.label && <Text style={styles.groupLabel}>{group.label}</Text>}
                <View style={styles.tileGrid}>
                  {group.entries.map((entry) => (
                    <TouchableOpacity
                      key={entry.id}
                      style={[styles.tile, isDesktop ? styles.tileDesktop : styles.tileMobile]}
                      onPress={() => openEntry(entry)}
                      accessibilityRole="button"
                      accessibilityLabel={entry.title}
                    >
                      <MaterialIcons name={entry.icon} size={28} color={COLORS.primary} />
                      <Text style={styles.tileText}>{entry.title}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <Modal
        visible={isAccountMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAccountMenuOpen(false)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsAccountMenuOpen(false)}>
          <View style={[styles.accountCard, { marginTop: Math.max(insets.top, 12) + 48 }]}>
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{user?.username}</Text>
              <Text style={styles.accountMeta}>{user?.userRole}</Text>
              {orgName && <Text style={styles.accountMeta}>Organisation: {orgName}</Text>}
              {tour && <Text style={styles.accountMeta}>Tour: {tour.name} ({tour.tourId})</Text>}
              {tour && <Text style={styles.accountMeta}>{tour.startDate} – {tour.endDate}</Text>}
            </View>
            <TouchableOpacity
              style={styles.accountItem}
              onPress={() => {
                setIsAccountMenuOpen(false);
                navigation.navigate('ChangePassword');
              }}
            >
              <MaterialIcons name="lock-reset" size={18} color={COLORS.textPrimary} />
              <Text style={styles.accountItemText}>Change password</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.accountItem}
              onPress={() => {
                setIsAccountMenuOpen(false);
                requestLogout();
              }}
            >
              <MaterialIcons name="logout" size={18} color={COLORS.textPrimary} />
              <Text style={styles.accountItemText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: COLORS.primary,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.white,
    opacity: 0.85,
  },
  accountButton: {
    padding: 4,
    marginLeft: 8,
  },
  content: {
    padding: 16,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginTop: 4,
    marginBottom: 6,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  tile: {
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileMobile: {
    width: '47%',
  },
  tileDesktop: {
    width: 180,
  },
  tileText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
  },
  accountCard: {
    width: 280,
    maxWidth: '100%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    paddingVertical: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  accountInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
    gap: 2,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  accountMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  accountItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  accountItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
});
