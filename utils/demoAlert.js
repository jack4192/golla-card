import { Alert as NativeAlert, Platform } from 'react-native';

function browserAlert(title, message, buttons) {
  if (typeof window === 'undefined') return;
  const content = [title, message].filter(Boolean).join('\n\n');
  const choices = Array.isArray(buttons) ? buttons : [];
  const actionable = choices.filter(item => item?.style !== 'cancel');
  const cancel = choices.find(item => item?.style === 'cancel');

  if (choices.length > 1 && cancel && actionable.length > 0) {
    if (window.confirm(content)) actionable[actionable.length - 1]?.onPress?.();
    else cancel.onPress?.();
    return;
  }
  window.alert(content);
  if (choices.length === 1) choices[0]?.onPress?.();
}

export const Alert = Platform.OS === 'web'
  ? { alert: browserAlert }
  : NativeAlert;
