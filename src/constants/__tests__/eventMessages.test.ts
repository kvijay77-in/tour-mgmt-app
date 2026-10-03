import { describe, expect, it } from '@jest/globals';
import {
  EVENT_ERROR_MESSAGES,
  formatEventErrorMessage,
  getEventErrorMessage,
} from '../eventMessages';

describe('event error messages', () => {
  it('maps all self-service, ownership, and registration errors', () => {
    const codes = [
      'VALIDATION_ERROR',
      'INVALID_STAGE_LAYOUT',
      'TOUR_NOT_ACTIVE',
      'RIDER_NOT_IN_TOUR',
      'RIDER_NOT_FOUND',
      'RIDE_NOT_FOUND',
      'RIDE_NOT_TODAY',
      'RIDE_NOT_ACTIVE',
      'STAGE_NOT_FOUND',
      'PIT_STOP_NOT_OPEN',
      'SELF_CHECKIN_NOT_ALLOWED',
      'NOT_RIDING_NOT_AVAILABLE',
      'QUIT_RIDING_NOT_AVAILABLE',
      'RIDER_ALREADY_QUIT',
      'QUIT_RIDING_CANCEL_NOT_ALLOWED',
      'NOT_OWN_CHECKIN',
      'NOT_OWN_DATA',
      'NOT_OWN_RECORD',
      'REGISTRATION_NOT_ENABLED',
      'REGISTRATION_CLOSED',
      'REGISTRATION_NOT_FOUND',
      'RIDER_NOT_REGISTERED_FOR_EVENT',
      'OCCURRENCE_NOT_ACTIVE',
      'SELF_SERVICE_NOT_ALLOWED',
    ];

    for (const code of codes) {
      expect(EVENT_ERROR_MESSAGES[code]).toBeDefined();
    }
    expect(EVENT_ERROR_MESSAGES.VALIDATION_ERROR.message).toBeNull();
  });

  it('formats rider IDs in registration errors', () => {
    expect(formatEventErrorMessage('RIDER_NOT_REGISTERED_FOR_EVENT', { riderId: 'R57' }))
      .toBe('Rider R57 is not registered for this event occurrence.');
  });

  it('preserves server text for unknown error codes', () => {
    expect(getEventErrorMessage('FUTURE_ERROR', 'Server-provided detail').message)
      .toBe('Server-provided detail');
  });
});