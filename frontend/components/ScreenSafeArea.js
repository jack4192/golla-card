// 화면 안쪽에 쓰는 안전 영역 (2026-11-25, 아이폰 바탕화면 웹앱에서 탭바 밑이 비던 문제).
// 웹: App.js 맨 바깥 SafeAreaView 가 이미 아이폰 홈 막대 여백(env(safe-area-inset-*))을 준다.
//   react-native-web 의 SafeAreaView 는 겹치면 그 여백을 겹친 만큼 또 더해서(홈 막대 34pt → 68pt) 화면 안쪽은 View 로 둔다.
// 휴대폰 앱(iOS·안드로이드)의 SafeAreaView 는 이미 안전 영역 안이면 여백을 더하지 않으므로 그대로 쓴다.
// 팝업(Modal) 안은 App.js 바깥에 그려져 겹치지 않으므로 SafeAreaView 를 그대로 쓴다.
import { Platform, SafeAreaView, View } from 'react-native';

const ScreenSafeArea = Platform.OS === 'web' ? View : SafeAreaView;

export default ScreenSafeArea;
