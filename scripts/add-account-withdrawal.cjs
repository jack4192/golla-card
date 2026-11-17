const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const mainPath = path.join(
  root,
  'screens',
  'MainScreen.js'
);

const componentPath = path.join(
  root,
  'components',
  'AccountWithdrawal.js'
);

const importLine =
  "import AccountWithdrawal from '../components/AccountWithdrawal';";

const footer = '<Text style={styles.settingsFooter}>';
const button = '<AccountWithdrawal />';

let main = fs.readFileSync(mainPath, 'utf8');

if (!main.includes(button)) {
  if (main.split(footer).length !== 2) {
    throw Error(
      '설정 하단 위치를 찾지 못했습니다. MainScreen.js는 변경하지 않았습니다.'
    );
  }

  main = main.replace(
    footer,
    button + '\n\n        ' + footer
  );
}

if (!main.includes(importLine)) {
  main = importLine + '\n' + main;
}

const component = String.raw`
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { reloadAppAsync } from 'expo';
import { deleteDemoData } from '../utils/privacyData';
import { waitForWalletWrites } from '../utils/wallet';

const QUESTIONS = [
  {
    title: '1. 탈퇴를 결정한 가장 큰 이유는 무엇인가요?',
    options: [
      '카드 추천이 기대만큼 도움이 되지 않아요',
      '앱을 자주 사용하지 않아요',
      '응답하지 않을게요',
    ],
  },
  {
    title: '2. 사용하면서 어떤 점이 가장 불편했나요?',
    options: [
      '화면과 이용 방법이 복잡해요',
      '원하는 카드·혜택 정보가 부족해요',
      '특별히 불편한 점은 없어요',
    ],
  },
];

async function restartApp() {
  if (Platform.OS === 'web') {
    window.location.reload();
  } else {
    await reloadAppAsync(
      'Account withdrawal completed'
    );
  }
}

// 삭제 성공을 확인한 뒤에만 앱을 다시 시작합니다.
export async function withdrawDemoAccount({
  wait = waitForWalletWrites,
  remove = deleteDemoData,
  restart = restartApp,
  onDeleted = () => {},
} = {}) {
  await wait();

  const report = await remove('account');

  if (!report || !report.ok || report.pending) {
    const failed =
      report && report.failed
        ? report.failed.join(', ')
        : '삭제 결과 확인 실패';

    throw Error(
      '삭제를 완료하지 못했습니다. 다시 시도해주세요.\n' +
      failed
    );
  }

  onDeleted();
  await restart();
}

export default function AccountWithdrawal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState('survey');
  const [answers, setAnswers] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const lock = useRef(false);
  const mounted = useRef(true);
  const didDelete = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const close = () => {
    if (lock.current || attempted) return;

    setOpen(false);
    setError('');
  };

  const begin = () => {
    setStep('survey');
    setAnswers(['', '']);
    setError('');
    setAttempted(false);
    setDeleted(false);

    didDelete.current = false;
    setOpen(true);
  };

  const submit = async () => {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError('');
    setAttempted(true);

    try {
      if (didDelete.current) {
        await restartApp();
      } else {
        await withdrawDemoAccount({
          onDeleted: () => {
            didDelete.current = true;

            if (mounted.current) {
              setDeleted(true);
            }
          },
        });
      }
    } catch (problem) {
      if (mounted.current) {
        setError(
          didDelete.current
            ? '탈퇴 처리는 완료되었지만 화면을 다시 열지 못했습니다. 아래 버튼으로 다시 시도하거나 앱을 다시 실행해주세요.'
            : problem.message ||
              '탈퇴 처리에 실패했습니다. 다시 시도해주세요.'
        );
      }
    } finally {
      lock.current = false;

      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={begin}
        style={s.entry}
      >
        <Text style={s.entryText}>
          회원 탈퇴
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <View style={s.overlay}>
          <View
            style={s.panel}
            accessibilityViewIsModal
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.content}
            >
              <Text
                accessibilityRole="header"
                style={s.title}
              >
                {deleted
                  ? '회원 탈퇴 완료'
                  : step === 'survey'
                    ? '회원 탈퇴'
                    : '정말 탈퇴하시겠습니까?'}
              </Text>

              {step === 'survey' ? (
                <>
                  <Text style={s.hint}>
                    떠나시는 이유를 알려주세요.
                    답변은 이번 데모에서 외부로 전송하거나
                    별도 저장하지 않습니다.
                  </Text>

                  {QUESTIONS.map((question, index) => (
                    <View
                      key={question.title}
                      style={s.group}
                    >
                      <Text style={s.question}>
                        {question.title}
                      </Text>

                      {question.options.map(option => (
                        <TouchableOpacity
                          key={option}
                          accessibilityRole="radio"
                          accessibilityState={{
                            checked:
                              answers[index] === option,
                          }}
                          onPress={() => {
                            setAnswers(previous =>
                              previous.map((value, i) =>
                                i === index
                                  ? option
                                  : value
                              )
                            );
                          }}
                          style={[
                            s.option,
                            answers[index] === option &&
                              s.selected,
                          ]}
                        >
                          <Text style={s.optionText}>
                            {answers[index] === option
                              ? '● '
                              : '○ '}
                            {option}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ))}

                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={!answers.every(Boolean)}
                    style={[
                      s.primary,
                      !answers.every(Boolean) &&
                        s.disabled,
                    ]}
                    onPress={() => setStep('confirm')}
                  >
                    <Text style={s.white}>
                      다음
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    style={s.secondary}
                    onPress={close}
                  >
                    <Text style={s.secondaryText}>
                      탈퇴 취소
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={s.hint}>
                    {deleted
                      ? '데모 계정 데이터가 삭제되었습니다. 첫 로그인 화면을 다시 불러옵니다.'
                      : '탈퇴하면 이 기기에 저장된 로그인 정보, 간편비밀번호, 동의, 일과·일정, 카드 추천·등록 설정이 삭제됩니다. 삭제한 데이터는 복원할 수 없습니다.'}
                  </Text>

                  {!deleted && (
                    <Text style={s.hint}>
                      실제 카드 해지나 금융기관
                      회원 탈퇴는 아닙니다.
                    </Text>
                  )}

                  {!!error && (
                    <Text
                      accessibilityRole="alert"
                      style={s.error}
                    >
                      {error}
                    </Text>
                  )}

                  {busy && (
                    <ActivityIndicator color="#C43D4F" />
                  )}

                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={submit}
                    style={[
                      s.danger,
                      busy && s.disabled,
                    ]}
                  >
                    <Text style={s.white}>
                      {busy
                        ? '처리 중…'
                        : deleted
                          ? '첫 화면으로 이동'
                          : attempted
                            ? '탈퇴 처리 다시 시도'
                            : '회원 탈퇴 확정'}
                    </Text>
                  </TouchableOpacity>

                  {!attempted && (
                    <>
                      <TouchableOpacity
                        accessibilityRole="button"
                        style={s.secondary}
                        onPress={() =>
                          setStep('survey')
                        }
                      >
                        <Text style={s.secondaryText}>
                          이전으로
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityRole="button"
                        style={s.secondary}
                        onPress={close}
                      >
                        <Text style={s.secondaryText}>
                          아니요, 계속 이용할게요
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  entry: {
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    marginTop: 12,
    minHeight: 48,
  },
  entryText: {
    color: '#B14452',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  overlay: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15,30,50,0.5)',
  },
  panel: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    backgroundColor: '#FFF',
    borderRadius: 20,
    overflow: 'hidden',
  },
  content: {
    padding: 24,
    gap: 14,
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#213553',
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: '#6B7A90',
  },
  group: {
    gap: 9,
    marginVertical: 5,
  },
  question: {
    fontSize: 15,
    fontWeight: '700',
    color: '#263D5D',
    lineHeight: 23,
  },
  option: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F7F9FC',
    borderWidth: 1,
    borderColor: '#E2E8F1',
  },
  selected: {
    borderColor: '#245DE5',
    backgroundColor: '#EDF3FF',
  },
  optionText: {
    color: '#304F77',
    fontSize: 13,
    lineHeight: 22,
  },
  primary: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#245DE5',
    alignItems: 'center',
  },
  danger: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#C43D4F',
    alignItems: 'center',
  },
  white: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondary: {
    padding: 13,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#F1F4F9',
  },
  secondaryText: {
    color: '#536985',
    fontSize: 14,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.4,
  },
  error: {
    color: '#B33448',
    fontSize: 13,
    lineHeight: 22,
  },
});
`;

fs.mkdirSync(
  path.dirname(componentPath),
  { recursive: true }
);

const backup =
  mainPath + '.before-withdrawal.bak';

if (!fs.existsSync(backup)) {
  fs.copyFileSync(mainPath, backup);
}

fs.writeFileSync(
  componentPath,
  component,
  'utf8'
);

fs.writeFileSync(
  mainPath,
  main,
  'utf8'
);

console.log(
  '완료: 설정 하단 회원 탈퇴 버튼 추가 / App.js 변경 없음'
);

console.log(
  '백업: screens/MainScreen.js.before-withdrawal.bak'
);