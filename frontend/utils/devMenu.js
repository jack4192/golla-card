// 화면 미리보기(개발 메뉴)를 보일지: 개발 중(__DEV__)이거나, 웹 빌드에 EXPO_PUBLIC_DEV_MENU=on 을 넣었을 때.
//   배포한 웹(Amplify, 사용자 모드)에는 안 보인다 (2026-11-25). App.js 메뉴와 MainScreen 아래 빈 칸이 같은 값을 쓴다.
import { Platform } from 'react-native';

export const DEV_MENU_ENABLED = __DEV__ || (Platform.OS === 'web' && process.env.EXPO_PUBLIC_DEV_MENU === 'on');
