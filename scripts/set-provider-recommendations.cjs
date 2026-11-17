const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');

const read = name =>
  fs.readFileSync(path.join(root, name), 'utf8');

const current = read('screens/RoutineRecommendationScreen.js');

let pattern = current.includes('PROVIDER_RECOMMENDATIONS_V1')
  ? read('screens/RoutinePatternRecommendationScreen.js')
  : current;

const oldLimit =
  'return (unowned.length ? unowned : rows).slice(0, 3);';

const newLimit =
  'return (unowned.length ? unowned : rows).slice(0, 1);';

if (!pattern.includes(newLimit)) {
  if (pattern.split(oldLimit).length !== 2) {
    throw Error(
      '기존 추천 화면 버전을 확인해주세요. 파일을 변경하지 않았습니다.'
    );
  }

  pattern = pattern.replace(oldLimit, newLimit);
}

const dataPath = path.join(
  root,
  'data/providerRecommendations.js'
);

const files = {
  'screens/RoutinePatternRecommendationScreen.js': pattern,

  'data/providerRecommendations.js': fs.existsSync(dataPath)
    ? read('data/providerRecommendations.js')
    : String.raw`
// 직접 제공받은 추천만 등록합니다.
// 현재 제공된 목록은 없습니다.
//
// 공통 필드:
// id, providerName, title, description, sourceUrl(https)
//
// 카드사 추천 필수:
// cardCode — cardCatalogCsv의 실제 상품 코드
//
// 가맹점 추천 필수:
// merchantName
// cardCode는 선택

export const PROVIDER_RECOMMENDATIONS = {
  issuer: [],
  merchant: [],
};
`,

  'screens/RoutineRecommendationScreen.js': String.raw`
import React, { useState } from 'react';

import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';

import {
  PROVIDER_RECOMMENDATIONS,
} from '../data/providerRecommendations';

import RoutinePatternRecommendationScreen
  from './RoutinePatternRecommendationScreen';

export {
  officialProduct,
  recentPattern,
} from './RoutinePatternRecommendationScreen';

// PROVIDER_RECOMMENDATIONS_V1

export const RECOMMENDATION_TABS = [
  {
    id: 'issuer',
    label: '1. 카드사 추천',
  },
  {
    id: 'merchant',
    label: '2. 가맹점 추천',
  },
];

const text = value =>
  typeof value === 'string' && !!value.trim();

export function sourceUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password
    )
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function providerItems(feed, kind) {
  const list = feed?.[kind];

  if (!Array.isArray(list)) {
    return {
      rows: [],
      invalid: true,
    };
  }

  const ids = new Set();
  let invalid = false;

  const rows = list.filter(item => {
    const card = CSV_CARD_CATALOG.find(
      row => row.code === item?.cardCode
    );

    const valid =
      item &&
      text(item.id) &&
      !ids.has(item.id) &&
      text(item.providerName) &&
      text(item.title) &&
      text(item.description) &&
      !!sourceUrl(item.sourceUrl) &&
      (
        kind === 'issuer'
          ? !!card && !!CARD_PRODUCTS[item.cardCode]?.image
          : text(item.merchantName)
      ) &&
      (
        !item.cardCode ||
        (
          !!card &&
          !!CARD_PRODUCTS[item.cardCode]?.image
        )
      );

    if (!valid) {
      invalid = true;
      return false;
    }

    ids.add(item.id);
    return true;
  });

  return {
    rows,
    invalid,
  };
}

function ProductImage({ card }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Text style={s.caption}>
        카드 이미지를 불러오지 못했어요.
      </Text>
    );
  }

  return (
    <Image
      source={CARD_PRODUCTS[card.code].image}
      style={s.image}
      resizeMode="contain"
      accessibilityLabel={
        card.name + ' 실제 상품 이미지'
      }
      onError={() => setFailed(true)}
    />
  );
}

export default function RoutineRecommendationScreen({
  onNext,
  onBack,
  providerRecommendations = PROVIDER_RECOMMENDATIONS,
}) {
  const [kind, setKind] = useState('issuer');
  const [pattern, setPattern] = useState(false);
  const [error, setError] = useState('');

  const { rows, invalid } = providerItems(
    providerRecommendations,
    kind
  );

  const leave = async () => {
    setError('');

    try {
      if (typeof onNext !== 'function') {
        throw Error('메인 화면 연결을 확인해주세요.');
      }

      await onNext();
    } catch (problem) {
      setError(
        problem.message ||
        '화면을 이동하지 못했습니다.'
      );
    }
  };

  const openSource = async item => {
    setError('');

    try {
      const url = sourceUrl(item.sourceUrl);

      if (!url) {
        throw Error('추천 안내 주소를 확인해주세요.');
      }

      await Linking.openURL(url);
    } catch (problem) {
      setError(
        problem.message ||
        '안내 페이지를 열지 못했습니다.'
      );
    }
  };

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>
          추천 혜택을 확인해보세요
        </Text>

        <View
          style={s.tabs}
          accessibilityRole="tablist"
        >
          {RECOMMENDATION_TABS.map(tab => (
            <TouchableOpacity
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{
                selected: kind === tab.id,
              }}
              onPress={() => {
                setKind(tab.id);
                setPattern(false);
                setError('');
              }}
              style={[
                s.tab,
                kind === tab.id && s.active,
              ]}
            >
              <Text
                style={[
                  s.tabText,
                  kind === tab.id && s.activeText,
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {pattern && kind === 'issuer' ? (
        <View style={s.pattern}>
          <View style={s.notice}>
            <Text style={s.noticeText}>
              앱 자체 추천 · 생활 패턴 기준
            </Text>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setPattern(false)}
              style={s.small}
            >
              <Text style={s.blue}>목록으로</Text>
            </TouchableOpacity>
          </View>

          <RoutinePatternRecommendationScreen
            onNext={onNext}
            onBack={onBack}
          />
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.hint}>
            {kind === 'issuer'
              ? '카드사에서 전달한 카드 상품 추천 목록입니다.'
              : '가맹점에서 전달한 추천·혜택 목록입니다.'}
          </Text>

          {invalid && (
            <Text
              style={s.error}
              accessibilityRole="alert"
            >
              일부 추천 정보를 확인하지 못했습니다.
            </Text>
          )}

          {!rows.length && (
            <View style={s.empty}>
              <Text style={s.emptyIcon}>
                {kind === 'issuer' ? '💳' : '🏪'}
              </Text>

              <Text style={s.name}>
                아직 도착한 추천이 없어요
              </Text>

              <Text style={s.hint}>
                {kind === 'issuer'
                  ? '카드사에서 제공받은 추천 목록이 없습니다.'
                  : '가맹점에서 제공받은 추천 목록이 없습니다.'}
              </Text>
            </View>
          )}

          {rows.map(item => {
            const card = CSV_CARD_CATALOG.find(
              row => row.code === item.cardCode
            );

            return (
              <View key={item.id} style={s.card}>
                <Text style={s.blue}>
                  제공: {item.providerName}
                </Text>

                <Text style={s.name}>
                  {item.title}
                </Text>

                {kind === 'merchant' && (
                  <Text style={s.name}>
                    {item.merchantName}
                  </Text>
                )}

                {card && (
                  <>
                    <ProductImage
                      key={card.code}
                      card={card}
                    />

                    <Text style={s.name}>
                      {card.name}
                    </Text>
                  </>
                )}

                <Text style={s.description}>
                  {item.description}
                </Text>

                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => openSource(item)}
                  style={s.secondary}
                >
                  <Text style={s.blue}>
                    제공처 안내·조건 보기
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {kind === 'issuer' && (
            <View style={s.card}>
              <Text style={s.name}>
                내 일과에 맞는 카드를 찾을까요?
              </Text>

              <Text style={s.hint}>
                생활 패턴으로 앱이 고른 참고 추천입니다.
                카드사에서 전달한 목록과는 별개입니다.
              </Text>

              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setPattern(true);
                  setError('');
                }}
                style={s.secondary}
              >
                <Text style={s.blue}>
                  생활 패턴으로 추천받기
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {!!error && (
            <Text
              style={s.error}
              accessibilityRole="alert"
            >
              {error}
            </Text>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            onPress={leave}
            style={s.primary}
          >
            <Text style={s.white}>메인으로</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => onBack?.()}
            style={s.small}
          >
            <Text style={s.blue}>
              일과 다시 설정하기
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F8FF',
  },
  header: {
    backgroundColor: '#FFF',
    padding: 18,
    paddingTop: 24,
    gap: 18,
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#173258',
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
  },
  tab: {
    flex: 1,
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: '#F1F4FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: {
    backgroundColor: '#245DE5',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#7C8AA1',
  },
  activeText: {
    color: '#FFF',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  body: {
    padding: 20,
    paddingBottom: 60,
    gap: 16,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  hint: {
    fontSize: 13,
    lineHeight: 23,
    color: '#7C8AA1',
  },
  empty: {
    paddingVertical: 44,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    borderRadius: 22,
    alignItems: 'center',
    gap: 14,
  },
  emptyIcon: {
    fontSize: 38,
  },
  name: {
    fontSize: 17,
    lineHeight: 26,
    fontWeight: '800',
    color: '#203D66',
  },
  card: {
    backgroundColor: '#FFF',
    padding: 20,
    borderRadius: 20,
    gap: 12,
  },
  image: {
    width: '100%',
    height: 210,
  },
  caption: {
    fontSize: 12,
    color: '#7C8AA1',
  },
  blue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#245DE5',
  },
  description: {
    fontSize: 14,
    lineHeight: 24,
    color: '#4F6685',
  },
  secondary: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
  },
  primary: {
    padding: 17,
    borderRadius: 14,
    backgroundColor: '#245DE5',
    alignItems: 'center',
  },
  white: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFF',
  },
  small: {
    padding: 12,
    alignItems: 'center',
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: '#B6364E',
  },
  pattern: {
    flex: 1,
  },
  notice: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#EDF3FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noticeText: {
    fontSize: 12,
    color: '#496A9B',
    flex: 1,
  },
});
`,
};

for (const content of Object.values(files)) {
  babel.parseSync(content, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['jsx'] },
  });
}

for (const [name, content] of Object.entries(files)) {
  const target = path.join(root, name);
  const backup = target + '.before-provider-tabs.bak';

  fs.mkdirSync(path.dirname(target), {
    recursive: true,
  });

  if (
    fs.existsSync(target) &&
    !fs.existsSync(backup)
  ) {
    fs.copyFileSync(target, backup);
  }

  fs.writeFileSync(target, content, 'utf8');
}

console.log(
  '완료: 1. 카드사 추천 / 2. 가맹점 추천'
);

console.log(
  'App.js 변경 없음. 기존 파일 백업 완료.'
);