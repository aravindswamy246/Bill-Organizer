import * as Notifications from 'expo-notifications';

import {
  cancelReminderNotifications,
  requestNotificationPermissions,
  scheduleReminderNotifications,
} from './notifications';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

const getPermissionsAsync = Notifications.getPermissionsAsync as jest.Mock;
const requestPermissionsAsync = Notifications.requestPermissionsAsync as jest.Mock;
const cancelScheduledNotificationAsync = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const scheduleNotificationAsync = Notifications.scheduleNotificationAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  requestPermissionsAsync.mockResolvedValue({ granted: true });
  cancelScheduledNotificationAsync.mockResolvedValue(undefined);
  scheduleNotificationAsync.mockResolvedValue('id');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('requestNotificationPermissions', () => {
  it('returns true without asking again when already granted', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await expect(requestNotificationPermissions()).resolves.toBe(true);
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns false without asking when denied and canAskAgain is false', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(requestNotificationPermissions()).resolves.toBe(false);
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks and returns the result when not granted but askable', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    requestPermissionsAsync.mockResolvedValue({ granted: true });
    await expect(requestNotificationPermissions()).resolves.toBe(true);
    expect(requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('cancelReminderNotifications', () => {
  it('cancels the 30d/7d/1d identifiers for the given reminder', async () => {
    await cancelReminderNotifications('r1');
    const ids = cancelScheduledNotificationAsync.mock.calls.map((call) => call[0]).sort();
    expect(ids).toEqual(['reminder-r1-1d', 'reminder-r1-30d', 'reminder-r1-7d']);
  });
});

describe('scheduleReminderNotifications', () => {
  it('schedules all three offsets when the expiry is far in the future', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 6, 8, 0, 0));

    await scheduleReminderNotifications({
      reminderId: 'r1',
      merchantName: 'Acme Insurance',
      expiryDate: '2026-08-15',
    });

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(3);
    const scheduled = scheduleNotificationAsync.mock.calls
      .map((call) => call[0])
      .sort((a, b) => a.identifier.localeCompare(b.identifier));
    expect(scheduled.map((s) => s.identifier)).toEqual([
      'reminder-r1-1d',
      'reminder-r1-30d',
      'reminder-r1-7d',
    ]);
    expect(scheduled[0].trigger.date).toEqual(new Date(2026, 7, 14, 9, 0, 0));
    expect(scheduled[1].trigger.date).toEqual(new Date(2026, 6, 16, 9, 0, 0));
    expect(scheduled[2].trigger.date).toEqual(new Date(2026, 7, 8, 9, 0, 0));
  });

  it('skips offsets that have already passed, keeping only the still-future ones', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 6, 6, 8, 0, 0));

    await scheduleReminderNotifications({
      reminderId: 'r1',
      merchantName: 'Acme Insurance',
      expiryDate: '2026-07-09',
    });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync.mock.calls[0][0].identifier).toBe('reminder-r1-1d');
  });

  it('does not schedule anything when permission is denied', async () => {
    getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });

    await scheduleReminderNotifications({
      reminderId: 'r1',
      merchantName: 'Acme Insurance',
      expiryDate: '2026-08-15',
    });

    expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(3);
    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule anything for an unparseable expiry date', async () => {
    await scheduleReminderNotifications({
      reminderId: 'r1',
      merchantName: 'Acme Insurance',
      expiryDate: 'not-a-date',
    });

    expect(scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
