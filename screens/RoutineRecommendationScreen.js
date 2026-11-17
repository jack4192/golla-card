
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';

import {
  CardReveal,
  officialProduct,
} from './RoutinePatternRecommendationScreen';

import {
  CATEGORIES,
  makeSignals,
  readEvents,
  readProfile,
} from '../utils/routineData';

import {
  benefitText,
  emptyPreferences,
  money,
  rankRecommendations,
  readPreferences,
} from '../utils/cardRecommendation';

import {
  restoreMyData,
  subscribeMyData,
} from '../utils/myDataService';

export {
  officialProduct,
  recentPattern,
} from './RoutinePatternRecommendationScreen';

export const RECOMMENDATION_LABELS = [
  '카드사 추천',
  '가맹점 추천',
];

export function buildTwoRecommendations(
  profile,
  events,
  saved,
  data,
  now = new Date()
) {
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const hasPattern =
    makeSignals(profile, events, day).length > 0;

  const input = hasPattern
    ? profile
    : { coffee: 'always' };

  const preferences = emptyPreferences();

  preferences.owned = [
    ...new Set([
      ...(saved?.owned || []),
      ...(data?.cards || [])
        .map(card => card.catalogCode)
        .filter(Boolean),
    ]),
  ];

  const ranked = rankRecommendations(
    input,
    events,
    preferences,
    now
  ).filter(row => officialProduct(row.card.code));

  const first =
    ranked.find(row => !row.owned) ||
    ranked[0] ||
    null;

  const signals = makeSignals(input, events, day);

  const merchants = CSV_CARD_CATALOG
    .filter(card => officialProduct(card.code))
    .flatMap(card => {
      const matches = (card.benefits || [])
        .filter(
          benefit => benefit.brandScope === 'BRAND_ONLY'
        )
        .flatMap(benefit => {
          const signal = signals.find(value =>
            CATEGORIES[value.id]?.words.some(word =>
              benefit.name
                .toLowerCase()
                .includes(word.toLowerCase())
            )
          );

          return signal
            ? [{
                benefit,
                weight: signal.weight,
                reasons: [
                  ...signal.reasons,
                  '가맹점 혜택: ' + benefit.name,
                ],
              }]
            : [];
        })
        .sort((a, b) => b.weight - a.weight);

      return matches.length
        ? [{
            card,
            matches,
            owned: preferences.owned.includes(card.code),
            score: matches[0].weight,
          }]
        : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.card.annualFee || 0) -
          Number(b.card.annualFee || 0) ||
        a.card.code.localeCompare(b.card.code)
    );

  const second =
    merchants.find(
      row => row.card.code !== first?.card.code
    ) ||
    merchants[0] ||
    null;

  return [first, second].map(
    (row, index) =>
      row
        ? {
            ...row,
            label: RECOMMENDATION_LABELS[index],
            example: !hasPattern,
          }
        : null
  );
}

export default function RoutineRecommendationScreen({
  onNext,
  onBack,
  presentation = 'screen',
}) {
  const [input, setInput] = useState(null);
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [details, setDetails] = useState(false);
  const [reduced, setReduced] = useState(null);
  const [busy, setBusy] = useState(false);

  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => new Date());

  const alive = useRef(true);
  const lock = useRef(false);

  useEffect(() => {
    alive.current = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (alive.current) setReduced(value);
      })
      .catch(() => {
        if (alive.current) setReduced(true);
      });

    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduced
    );

    const app = AppState.addEventListener(
      'change',
      state => {
        if (state === 'active') {
          setNow(new Date());
        }
      }
    );

    return () => {
      alive.current = false;
      motion.remove();
      app.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError('');
    setNotice('');

    Promise.all([
      readProfile(),
      readEvents(),
      readPreferences(),
      restoreMyData().catch(() => {
        if (active) {
          setNotice(
            '마이데이터를 읽지 못해 일과 정보로 추천합니다.'
          );
        }

        return null;
      }),
    ])
      .then(([profile, events, saved, snapshot]) => {
        if (!active) return;

        setInput({ profile, events, saved });
        setData(snapshot);
        setIndex(0);
      })
      .catch(problem => {
        if (active) {
          setError(
            problem.message ||
            '추천 정보를 읽지 못했습니다.'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const off = subscribeMyData(value => {
      if (active) setData(value);
    });

    return () => {
      active = false;
      off();
    };
  }, [reload]);

  const items = useMemo(
    () =>
      input
        ? buildTwoRecommendations(
            input.profile,
            input.events,
            input.saved,
            data,
            now
          )
        : [null, null],
    [input, data, now]
  );

  const selected = items[index];
  const card = selected?.card;

  const match = selected
    ? [...selected.matches]
        .sort((a, b) => b.weight - a.weight)[0]
    : null;

  const run = async action => {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError('');

    try {
      await action();
    } catch (problem) {
      if (alive.current) {
        setError(
          problem.message ||
          '다시 시도해주세요.'
        );
      }
    } finally {
      lock.current = false;

      if (alive.current) {
        setBusy(false);
      }
    }
  };

  const apply = () =>
    run(async () => {
      const product = officialProduct(card?.code);

      if (!product) {
        throw Error('카드 상품 주소를 확인해주세요.');
      }

      await Linking.openURL(product.url);
    });

  const next = () =>
    run(async () => {
      if (typeof onNext !== 'function') {
        throw Error('다음 화면 연결을 확인해주세요.');
      }

      await onNext();
    });

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.container}>
        {presentation !== 'popup' && (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onBack?.()}
            style={s.small}
          >
            <Text style={s.link}>
              ← 일과 다시 확인
            </Text>
          </TouchableOpacity>
        )}

        <Text style={s.caption}>
          당신의 일상에 어울리는 한 장
        </Text>

        <Text style={s.title}>
          이 카드를 추천합니다!
        </Text>

        <Text style={s.demo}>
          시연 · 카드사·가맹점이 직접 제공한 추천은 아닙니다.
        </Text>

        {loading ? (
          <ActivityIndicator
            color="#245DE5"
            size="large"
          />
        ) : card ? (
          <>
            <Text style={s.label}>
              {index + 1}. {selected.label}
            </Text>

            <Text style={s.reason}>
              {selected.example
                ? '일과를 등록하기 전이라 카드 상품 예시를 보여드려요.'
                : match?.reasons?.[0] ||
                  '일과에 맞는 혜택을 살펴봤어요.'}
            </Text>

            {index === 1 && (
              <Text style={s.caption}>
                가맹점 혜택을 기준으로 골랐어요.
                실제 적용 대상과 조건을 확인해주세요.
              </Text>
            )}

            <View style={s.hero}>
              <Text style={s.star}>✦</Text>

              <Text style={s.cardName}>
                {card.name}
              </Text>

              <Text style={s.caption}>
                {card.issuer} · 연회비{' '}
                {money(card.annualFee || 0)}
                {selected.owned ? ' · 보유 카드' : ''}
              </Text>

              <CardReveal
                key={index + ':' + card.code}
                card={card}
                reduced={reduced}
                replay={0}
              />

              {match && (
                <View style={s.badge}>
                  <Text style={s.benefit}>
                    {benefitText(match.benefit)}
                  </Text>

                  <Text style={s.caption}>
                    {match.benefit.name}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                accessibilityRole="button"
                onPress={() =>
                  setDetails(value => !value)
                }
                style={s.small}
              >
                <Text style={s.link}>
                  {details
                    ? '추천 이유·혜택 조건 접기'
                    : '추천 이유·혜택 조건 확인'}
                </Text>
              </TouchableOpacity>

              {details && (
                <View style={s.details}>
                  {selected.matches
                    .slice(0, 3)
                    .map((row, i) => (
                      <View key={i} style={s.detail}>
                        <Text style={s.strong}>
                          {row.benefit.name} ·{' '}
                          {benefitText(row.benefit)}
                        </Text>

                        <Text style={s.detailText}>
                          {row.reasons.join(' · ')}
                        </Text>

                        <Text style={s.detailText}>
                          전월 실적:{' '}
                          {row.benefit.minPrevSpend == null
                            ? '확인 필요'
                            : money(
                                row.benefit.minPrevSpend
                              ) + ' 이상'}
                        </Text>

                        <Text style={s.detailText}>
                          {row.benefit.note ||
                            '카드사 상품 안내에서 상세 조건을 확인해주세요.'}
                        </Text>
                      </View>
                    ))}

                  <Text style={s.detailText}>
                    할인율·적립률은 상품 안내값입니다.
                    실적·가맹점·시간·결제 방식·한도에 따라
                    달라지며 실제 절약액을 뜻하지 않습니다.
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <View style={s.empty}>
            <Text style={s.reason}>
              {error ||
                '이 항목에 맞는 카드 혜택을 확인하지 못했어요.'}
            </Text>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() =>
                setReload(value => value + 1)
              }
              style={s.small}
            >
              <Text style={s.link}>
                다시 불러오기
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.pager}>
          {RECOMMENDATION_LABELS.map((label, i) => (
            <TouchableOpacity
              key={label}
              accessibilityRole="button"
              accessibilityLabel={
                (i + 1) + '. ' + label
              }
              accessibilityState={{
                selected: index === i,
              }}
              disabled={busy}
              onPress={() => {
                setIndex(i);
                setDetails(false);
                setError('');
              }}
              style={s.choice}
            >
              <View
                style={[
                  s.circle,
                  index === i && s.active,
                ]}
              >
                <Text
                  style={[
                    s.number,
                    index === i && s.white,
                  ]}
                >
                  {i + 1}
                </Text>
              </View>

              <Text style={s.link}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!loading && card && (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={busy}
              onPress={apply}
              style={[
                s.primary,
                busy && s.dim,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={s.white}>
                  카드 신청
                </Text>
              )}
            </TouchableOpacity>

            <Text style={s.caption}>
              카드사 공식 상품 안내로 이동합니다.
              발급 신청은 카드사에서 진행합니다.
            </Text>
          </>
        )}

        {!!notice && (
          <Text style={s.caption}>{notice}</Text>
        )}

        {!!error && card && (
          <Text
            style={s.error}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        )}

        {presentation !== 'popup' && (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy}
            onPress={next}
            style={s.small}
          >
            <Text style={s.caption}>
              괜찮아요, 메인으로 갈게요
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },
  content: {
    padding: 20,
    paddingBottom: 35,
  },
  container: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: 14,
  },
  title: {
    fontSize: 27,
    lineHeight: 38,
    fontWeight: '900',
    color: '#173258',
    textAlign: 'center',
  },
  caption: {
    fontSize: 12,
    lineHeight: 21,
    color: '#8393AC',
    textAlign: 'center',
  },
  demo: {
    fontSize: 11,
    lineHeight: 18,
    color: '#8D9AB0',
    textAlign: 'center',
  },
  label: {
    fontSize: 15,
    fontWeight: '800',
    color: '#245DE5',
    textAlign: 'center',
  },
  reason: {
    fontSize: 16,
    lineHeight: 27,
    color: '#4B6589',
    textAlign: 'center',
  },
  hero: {
    backgroundColor: '#FFF',
    borderRadius: 26,
    padding: 20,
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E6EEFB',
  },
  star: {
    fontSize: 26,
    color: '#DCAF43',
  },
  cardName: {
    fontSize: 21,
    lineHeight: 30,
    fontWeight: '900',
    color: '#213D68',
    textAlign: 'center',
  },
  badge: {
    alignSelf: 'stretch',
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#F0F5FF',
    gap: 6,
  },
  benefit: {
    fontSize: 22,
    fontWeight: '900',
    color: '#245DE5',
    textAlign: 'center',
  },
  small: {
    padding: 12,
    alignItems: 'center',
  },
  link: {
    fontSize: 12,
    fontWeight: '700',
    color: '#245DE5',
  },
  details: {
    alignSelf: 'stretch',
    gap: 12,
  },
  detail: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#E8EEF8',
    gap: 6,
  },
  strong: {
    fontSize: 13,
    lineHeight: 22,
    fontWeight: '800',
    color: '#244C8D',
  },
  detailText: {
    fontSize: 12,
    lineHeight: 21,
    color: '#73839D',
  },
  pager: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 26,
  },
  choice: {
    alignItems: 'center',
    gap: 7,
    padding: 8,
  },
  circle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E5ECFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: '#245DE5',
  },
  number: {
    fontWeight: '800',
    color: '#879BC0',
  },
  white: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800',
  },
  primary: {
    padding: 17,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#245DE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    padding: 30,
  },
  error: {
    fontSize: 12,
    lineHeight: 21,
    color: '#B6364E',
    textAlign: 'center',
  },
  dim: {
    opacity: 0.5,
  },
});
