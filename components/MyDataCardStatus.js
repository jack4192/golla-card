import React, { useEffect, useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { getMyDataSnapshot, subscribeMyData, restoreMyData, findImportedCard } from '../utils/myDataService';
export { mergeImportedWallet } from '../utils/myDataService';
export const money = value => Number(value || 0).toLocaleString('ko-KR') + '원';
export function useMyDataSnapshot(enabled = true) {
  const [snapshot, setSnapshot] = useState(() => enabled ? getMyDataSnapshot() : null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const off = subscribeMyData(value => {
      if (alive) setSnapshot(value);
    });
    restoreMyData().then(value => {
      if (alive) setSnapshot(value);
    }).catch(problem => {
      if (alive) setError(problem.message);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
      off();
    };
  }, [enabled]);
  return {
    snapshot: enabled ? snapshot : null,
    error: enabled ? error : '',
    loading: enabled && loading
  };
}
export const box = {
  backgroundColor: "#FFFFFF",
  borderRadius: 22,
  padding: 20,
  marginVertical: 8,
  gap: 12,
  borderWidth: 1,
  borderColor: "#E3EAF4"
};
export const title = {
  fontSize: 16,
  fontWeight: "800",
  color: "#142D4E"
};
export const hint = {
  fontSize: 13,
  lineHeight: 22,
  color: "#5A6E89"
};
const reward = (value, unit) => value == null ? '확인 필요' : Number(value).toLocaleString('ko-KR') + (unit === 'POINT' ? 'P' : unit === 'COUNT' ? '회' : unit === 'UNKNOWN' ? ' (단위 확인 필요)' : '원');
export default function MyDataCardStatus({
  card,
  expanded = false
}) {
  const {
    snapshot,
    error
  } = useMyDataSnapshot();
  const [show, setShow] = useState(expanded);
  const imported = findImportedCard(card, snapshot);
  if (!imported) {
    return error ? <Text style={hint}>{error}</Text> : null;
  }
  const status = imported.status;
  return <View style={box}>
      <Text style={title}>
        예시 내역 · {imported.name}
      </Text>

      <Text style={hint}>
        {snapshot.label} · 기준 {snapshot.asOf} KST
      </Text>

      <Text style={title}>
        {status.month} 누적 사용액{' '}
        {money(status.currentSpend)}
      </Text>

      <Text style={hint}>
        전월 실적 {money(status.previousSpend)}
        {' · '}이번 달은 일부 기간입니다.
      </Text>

      <View accessible accessibilityLabel={'실적 진행 ' + Math.round(status.progress * 100) + '퍼센트'} style={{
      height: 8,
      backgroundColor: '#E6EDF8',
      borderRadius: 5,
      overflow: 'hidden'
    }}>
        <View style={{
        height: 8,
        width: status.progress * 100 + '%',
        backgroundColor: "#245DE5"
      }} />
      </View>

      <Text style={hint}>
        {status.nextThreshold != null ? '다음 실적 구간 ' + money(status.nextThreshold) + '까지 ' + money(status.remainingToNext) : '등록된 실적 구간의 최고 기준에 도달했거나 추가 구간이 없습니다.'}
      </Text>

      <TouchableOpacity accessibilityRole="button" onPress={() => setShow(!show)} style={{
      paddingVertical: 10
    }}>
        <Text style={{
        color: "#245DE5",
        fontWeight: '700'
      }}>
          {show ? '한도 현황 접기' : '할인·적립 한도 현황 보기'}
        </Text>
      </TouchableOpacity>

      {show && (status.caps.length ? status.caps.map((cap, index) => <View key={index} style={{
      paddingVertical: 8,
      borderTopWidth: 1,
      borderColor: "#E3EAF4",
      gap: 4
    }}>
                <Text style={title}>
                  {cap.label}
                </Text>

                <Text style={hint}>
                  {cap.unit === 'USAGE_KRW' ? '혜택 대상 결제금액 한도 · ' : ''}
                  사용 {reward(cap.used, cap.unit)}
                  {' / '}한도 {reward(cap.limit, cap.unit)}
                  {' · '}남음 {reward(cap.remaining, cap.unit)}
                </Text>

                {cap.unit === 'UNKNOWN' && <Text style={hint}>
                    원화·포인트가 혼합되어 통합 잔여
                    한도를 임의로 계산하지 않았습니다.
                  </Text>}
              </View>) : <Text style={hint}>
                현재 실적 구간에 등록된
                월 한도 조건이 없습니다.
              </Text>)}

      <Text style={hint}>
        예시 내역에 기록된 혜택을 기준으로 표시해요.
        원화·포인트·혜택 대상 사용액 한도를 구분하며,
        프로모션은 기본 한도에서 제외합니다.
        금융사 확정 실적이 아닙니다.
      </Text>
    </View>;
}
