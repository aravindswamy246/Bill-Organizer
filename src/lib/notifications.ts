import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Days-before-expiry offsets a reminder notification is scheduled at. */
const OFFSETS_DAYS = [30, 7, 1] as const;

/** Deterministic per-offset identifier so we can cancel/reschedule a
 * reminder's notifications without needing to persist the ids returned by
 * `scheduleNotificationAsync`. */
function identifierFor(reminderId: string, offsetDays: number): string {
  return `reminder-${reminderId}-${offsetDays}d`;
}

/** Requests OS notification permission. Safe to call repeatedly — no-ops if
 * already granted or denied. Returns whether the app can present alerts. */
export async function requestNotificationPermissions(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

if (Platform.OS === 'android') {
  void Notifications.setNotificationChannelAsync('reminders', {
    name: 'Warranty & insurance reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export type ReminderNotificationInput = {
  reminderId: string;
  merchantName: string;
  /** ISO date (YYYY-MM-DD) the warranty/insurance expires. */
  expiryDate: string;
};

/** Cancels any previously scheduled notifications for a reminder. Always
 * call this before rescheduling (e.g. when the expiry date changes) so
 * stale-dated notifications never linger. */
export async function cancelReminderNotifications(reminderId: string): Promise<void> {
  await Promise.all(
    OFFSETS_DAYS.map((offset) =>
      Notifications.cancelScheduledNotificationAsync(identifierFor(reminderId, offset)),
    ),
  );
}

/**
 * (Re)schedules the 30/7/1-day-before-expiry local notifications for a
 * warranty/insurance reminder. Offsets that have already passed (e.g. the
 * expiry is only 5 days out) are silently skipped rather than firing
 * immediately or in the past.
 */
export async function scheduleReminderNotifications({
  reminderId,
  merchantName,
  expiryDate,
}: ReminderNotificationInput): Promise<void> {
  await cancelReminderNotifications(reminderId);

  const granted = await requestNotificationPermissions();
  if (!granted) return;

  const expiry = new Date(`${expiryDate}T09:00:00`);
  if (Number.isNaN(expiry.getTime())) return;
  const now = new Date();

  await Promise.all(
    OFFSETS_DAYS.map((offsetDays) => {
      const triggerDate = new Date(expiry.getTime() - offsetDays * 24 * 60 * 60 * 1000);
      if (triggerDate <= now) return Promise.resolve();
      return Notifications.scheduleNotificationAsync({
        identifier: identifierFor(reminderId, offsetDays),
        content: {
          title: 'Bill Organizer',
          body: `Your ${merchantName} warranty/insurance expires in ${offsetDays} day${offsetDays === 1 ? '' : 's'}.`,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerDate },
      });
    }),
  );
}
