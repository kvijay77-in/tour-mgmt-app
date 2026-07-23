import { CheckIn } from '../../types/models';

export type DashboardCheckInEvent = {
  checkIn: CheckIn;
};

type Listener = (event: DashboardCheckInEvent) => void;

const listeners = new Set<Listener>();

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
