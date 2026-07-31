import { CheckIn } from '../../types/models';

export type DashboardCheckInEvent = {
  checkIn: CheckIn;
};

export type DashboardRefreshEvent = {
  reason: 'ride_status_changed';
  rideId?: string;
};

type Listener = (event: DashboardCheckInEvent) => void;
type RefreshListener = (event: DashboardRefreshEvent) => void;

const listeners = new Set<Listener>();
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
