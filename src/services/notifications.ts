import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { NotifierPort } from "../core/store";
import { NOTIF_PREFIX } from "../core/notifPlan";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

async function permitted(ask: boolean): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.status === "granted") return true;
  if (!ask || cur.status === "denied" && !cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).status === "granted";
}

/** Local notifications only: scheduled on the device, no push server. */
export const notifier: NotifierPort = {
  async sync(dated, daily) {
    if (Platform.OS === "web") return false;
    // Ask once there is something to schedule; the system remembers a refusal.
    if (!(await permitted(dated.length + daily.length > 0))) return false;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter(n => n.identifier.startsWith(NOTIF_PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    for (const n of dated) {
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
      });
    }
    for (const n of daily) {
      await Notifications.scheduleNotificationAsync({
        identifier: n.id,
        content: { title: n.title, body: n.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: n.hour, minute: n.minute },
      });
    }
    return true;
  },
};

/** A one time reminder, used by the focus timer to say a session is over while the app is closed. */
export async function scheduleSessionEnd(secondsFromNow: number, goal: string): Promise<string | null> {
  if (Platform.OS === "web" || !(await permitted(false))) return null;
  return Notifications.scheduleNotificationAsync({
    identifier: `${NOTIF_PREFIX}focus`,
    content: { title: "Focus session done", body: goal ? `${goal}. Nice work.` : "Nice work. Take a break." },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, Math.round(secondsFromNow)) },
  });
}
export const cancelSessionEnd = () => Notifications.cancelScheduledNotificationAsync(`${NOTIF_PREFIX}focus`).catch(() => undefined);
