import { REGISTRATION_MESSAGES } from '../constants/eventMessages';
import { EventRegistration, OccurrenceStatus } from '../types/models';

export interface RegistrableRider {
  riderId: string;
  name: string;
}

export interface RegistrationEditState {
  editable: boolean;
  notice: string | null;
}

export function sortRegistrations(items: readonly EventRegistration[]): EventRegistration[] {
  return [...items].sort((a, b) => a.riderId.localeCompare(b.riderId, undefined, { numeric: true }));
}

export function filterRegistrations(items: readonly EventRegistration[], query: string): EventRegistration[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return sortRegistrations(items);
  return sortRegistrations(items.filter((item) =>
    item.riderId.toLocaleLowerCase().includes(normalizedQuery)
    || (item.name ?? '').toLocaleLowerCase().includes(normalizedQuery)));
}

export function getRegistrableRiders(
  riderNamesById: Readonly<Record<string, string | null>>,
  registrations: readonly EventRegistration[],
): RegistrableRider[] {
  const registeredIds = new Set(registrations.map((item) => item.riderId));
  return Object.entries(riderNamesById)
    .filter(([riderId]) => !registeredIds.has(riderId))
    .map(([riderId, name]) => ({ riderId, name: name || 'Unknown' }))
    .sort((a, b) => a.riderId.localeCompare(b.riderId, undefined, { numeric: true }));
}

export function getRegistrationEditState(
  occurrenceStatus: OccurrenceStatus,
  registrationEnabled: boolean,
  isOnline: boolean,
  canManage: boolean,
): RegistrationEditState {
  if (!canManage) return { editable: false, notice: 'You do not have permission to manage registrations.' };
  if (!registrationEnabled) return { editable: false, notice: REGISTRATION_MESSAGES.NOT_ENABLED };
  if (occurrenceStatus !== OccurrenceStatus.PLANNED) {
    return { editable: false, notice: REGISTRATION_MESSAGES.READ_ONLY };
  }
  if (!isOnline) return { editable: false, notice: REGISTRATION_MESSAGES.OFFLINE };
  return { editable: true, notice: null };
}

export function formatRegistrationSource(source: EventRegistration['source']): 'Rider' | 'Staff' {
  return source === 'RIDER' ? 'Rider' : 'Staff';
}

export function addRegistration(
  items: readonly EventRegistration[],
  registration: EventRegistration,
): EventRegistration[] {
  return sortRegistrations([
    ...items.filter((item) => item.riderId !== registration.riderId),
    registration,
  ]);
}

export function removeRegistration(
  items: readonly EventRegistration[],
  riderId: string,
): EventRegistration[] {
  return items.filter((item) => item.riderId !== riderId);
}