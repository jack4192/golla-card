// AI 안내 문구 (2026-11-24 수정사항: 시스템 맨 아래 작게). 홈뿐 아니라 로그인 뒤의 모든 화면 맨 아래에 같은 문구를 둔다
// (2026-11-24 사용자 요청). 로그인·회원가입·동의 화면은 AI 를 쓰기 전이라 넣지 않는다.
import React from 'react';
import { StyleSheet, Text } from 'react-native';

export const AI_NOTICE = '본 시스템은 AI를 활용한 카드 자동 배치 및 추천으로 부정확한 안내가 포함될 수 있습니다. '
  + '평소 소비가 아주 적은 편이거나 불규칙적이신 분께는 일부 오안내가 섞일 수 있습니다.';

export default function AiNotice({ style }) {
  return <Text style={[s.notice, style]}>{AI_NOTICE}</Text>;
}

const s = StyleSheet.create({
  notice: { fontSize: 11, lineHeight: 16, color: '#8B95A5', textAlign: 'center', paddingHorizontal: 12, marginTop: 4 },
});
