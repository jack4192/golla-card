import * as Haptics from 'expo-haptics';
import * as Brightness from 'expo-brightness';

export const selectionFeedback = () => {
  Haptics.selectionAsync().catch(() => {});
};
export const successFeedback = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

export async function makePaymentScreenBright() {
  try {
    const { status } = await Brightness.requestPermissionsAsync();
    if (status !== 'granted') return () => {};
    const oldValue = await Brightness.getBrightnessAsync();
    await Brightness.setBrightnessAsync(1);
    return () => { Brightness.setBrightnessAsync(oldValue).catch(() => {}); };
  } catch { return () => {}; }
}
