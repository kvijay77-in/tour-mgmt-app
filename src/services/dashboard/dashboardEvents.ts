import { CheckIn } from '../../types/models';

export type DashboardCheckInEvent = {
  checkIn: CheckIn;
};

/** Fired when a check-in entry is cancelled (e.g. from the Check-In Log tab). */
export type DashboardCancelEvent = {
  checkIn: CheckIn;
};

export type DashboardRefreshEvent = {
  reason: 'ride_status_changed' | 'checkins_synced';
  rideId?: string;
};

type Listener = (event: DashboardCheckInEvent) => void;
type CancelListener = (event: DashboardCancelEvent) => void;
type RefreshListener = (event: DashboardRefreshEvent) => void;

const listeners = new Set<Listener>();
const cancelListeners = new Set<CancelListener>();
const refreshListeners = new Set<RefreshListener>();

export function subscribeDashboardCheckInEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishDashboardCheckInEvent(event: DashboardCheckInEvent): void {
  listeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeDashboardCancelEvent(listener: CancelListener): () => void {
  cancelListeners.add(listener);
  return () => {
    cancelListeners.delete(listener);
  };
}

export function publishDashboardCancelEvent(event: DashboardCancelEvent): void {
  cancelListeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeDashboardRefreshEvent(listener: RefreshListener): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

export function publishDashboardRefreshEvent(event: DashboardRefreshEvent): void {
  refreshListeners.forEach((listener) => {
    listener(event);
  });
}
