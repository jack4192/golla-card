
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  DEMO_USERS,
  importMyData,
  getMyDataSnapshot,
} from '../utils/myDataService';

import {
  box,
  title,
  hint,
} from '../components/MyDataCardStatus';

const STEPS = [
  '보유 카드 목록 불러오기·자동 등록',
  '최근 6개월 결제내역 불러오기',
  '카드별 실적·한도 현황 준비',
];

const button = {
  padding: 16,
  backgroundColor: '#245DE5',
  borderRadius: 12,
  alignItems: 'center',
  marginVertical: 5,
};

export default function MyDataLoadingScreen({
  onNext,
  userId,
}) {
  const [selected, setSelected] = useState(
    String(
      userId ||
      getMyDataSnapshot()?.userId ||
      DEMO_USERS[0]?.id ||
      '1'
    )
  );

  const [step, setStep] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [result, setResult] = useState(null);

  const active = useRef(true);
  const request = useRef(0);
  const lock = useRef(false);

  const run = async id => {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setStep(0);
    setFailure('');
    setResult(null);

    const ticket = ++request.current;

    try {
      const data = await importMyData(
        id,
        value => {
          if (
            active.current &&
            request.current === ticket
          ) {
            setStep(value);
          }
        },
        {
          isCancelled: () =>
            !active.current ||
            request.current !== ticket,
        }
      );

      if (
        active.current &&
        request.current === ticket
      ) {
        setResult(data);
      }
    } catch (error) {
      if (
        active.current &&
        request.current === ticket
      ) {
        setFailure(error.message);
      }
    } finally {
      if (request.current === ticket) {
        lock.current = false;

        if (active.current) {
          setBusy(false);
        }
      }
    }
  };

  useEffect(() => {
    active.current = true;
    run(selected);

    return () => {
      active.current = false;
      request.current += 1;
      lock.current = false;
    };
  }, []);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: 24,
        gap: 16,
        flexGrow: 1,
        backgroundColor: '#F5F7FC',
      }}
    >
      <Text style={{ ...title, fontSize: 25 }}>
        가상 마이데이터 불러오기
      </Text>

      <Text style={hint}>
        실제 금융기관에 연결하지 않습니다.
        선택한 데모 사용자의 DB 데이터만 불러옵니다.
        로그인 계정 자동 연결은 이후 통합합니다.
      </Text>

      <View style={box}>
        <Text style={title}>체험할 사용자</Text>

        {DEMO_USERS.map(user => (
          <TouchableOpacity
            key={user.id}
            accessibilityRole="radio"
            accessibilityState={{
              checked: selected === user.id,
            }}
            disabled={busy}
            onPress={() => {
              setSelected(user.id);
              setResult(null);
              setStep(-1);
              setFailure('');
            }}
            style={{
              padding: 12,
              backgroundColor:
                selected === user.id
                  ? '#EAF1FF'
                  : '#F7F9FC',
              borderRadius: 10,
            }}
          >
            <Text style={title}>
              {selected === user.id ? '● ' : '○ '}
              {user.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={box}>
        {STEPS.map((label, index) => (
          <Text
            key={label}
            style={{
              ...hint,
              color:
                step > index
                  ? '#168264'
                  : '#536B8F',
            }}
          >
            {step > index
              ? '✓ '
              : busy && step === index
                ? '● '
                : '○ '}
            {label}
          </Text>
        ))}

        {busy && (
          <ActivityIndicator color="#245DE5" />
        )}
      </View>

      {!!failure && (
        <View
          accessibilityRole="alert"
          style={box}
        >
          <Text style={{ color: '#B4374B' }}>
            {failure}
          </Text>
          <Text style={hint}>
            기존 데이터는 불러오기 저장이
            성공하기 전까지 유지됩니다.
          </Text>
        </View>
      )}

      {!busy && !result && (
        <TouchableOpacity
          accessibilityRole="button"
          style={button}
          onPress={() => run(selected)}
        >
          <Text
            style={{
              color: '#FFF',
              fontWeight: '800',
            }}
          >
            {failure
              ? '다시 시도'
              : '선택한 사용자 불러오기'}
          </Text>
        </TouchableOpacity>
      )}

      {result && (
        <View style={box}>
          <Text style={title}>
            불러오기 완료
          </Text>

          <Text style={hint}>
            보유 카드 {result.cards.length}장
            {' · '}결제{' '}
            {result.transactionCount.toLocaleString('ko-KR')}건
          </Text>

          <Text style={hint}>
            소비 분석 {result.period}
            {' · '}실적 기준 {result.asOf} KST
          </Text>

          <TouchableOpacity
            accessibilityRole="button"
            style={button}
            onPress={async () => {
              try {
                if (typeof onNext !== 'function') {
                  throw Error(
                    '분석 결과 화면 연결을 확인해주세요.'
                  );
                }
                await onNext(result);
              } catch (error) {
                setFailure(error.message);
              }
            }}
          >
            <Text
              style={{
                color: '#FFF',
                fontWeight: '800',
              }}
            >
              소비 분석 결과 보기
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}
