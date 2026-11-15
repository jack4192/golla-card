
import React, { useEffect, useState } from 'react';

import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
} from 'react-native';

import * as Location from 'expo-location';

const API_BASE = 'http://127.0.0.1:3030';

const SEARCH_KEYWORDS = [
  '스타벅스',
  'CU',
  'GS25',
];

function isValidStore(place, keyword) {
  const name = String(place.name || '')
    .replace(/\s/g, '')
    .toUpperCase();

  const category = String(place.category || '');

  if (keyword === '스타벅스') {
    return (
      name.includes('스타벅스') &&
      category.includes('카페')
    );
  }

  if (keyword === 'CU') {
    return (
      name.startsWith('CU') &&
      category.includes('편의점')
    );
  }

  if (keyword === 'GS25') {
    return (
      name.startsWith('GS25') &&
      category.includes('편의점')
    );
  }

  return false;
}

function formatDistance(distance) {
  const meters = Number(distance);

  if (!Number.isFinite(meters)) {
    return '거리 확인 불가';
  }

  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }

  return `${(meters / 1000).toFixed(1)}km`;
}

export default function NearbyPlacesModal({
  visible,
  onClose,
  locationAgreed,
  onRefreshConsent,
}) {
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [resultMessage, setResultMessage] = useState('');
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    if (!visible) {
      setPlaces([]);
      setErrorMessage('');
      setResultMessage('');
      setCurrentLocation(null);
      setLoading(false);
    }
  }, [visible]);

  const searchNearby = async () => {
    if (loading) return;

    setLoading(true);
    setPlaces([]);
    setErrorMessage('');
    setResultMessage('');

    try {
      // 1. 저장된 위치 동의 상태 재확인
      let agreed = locationAgreed;

      if (onRefreshConsent) {
        agreed = await onRefreshConsent();
      }

      if (!agreed) {
        throw new Error(
          '위치정보 활용에 동의하지 않았습니다. 약관 또는 설정에서 위치 동의를 먼저 해주세요.'
        );
      }

      // 2. 현재 검색 서버는 PC 로컬 웹용
      if (Platform.OS !== 'web') {
        throw new Error(
          '주변 매장 검색은 현재 PC 웹 개발환경에서 테스트할 수 있습니다. 모바일 연동은 별도 서버 설정이 필요합니다.'
        );
      }

      if (
        typeof window === 'undefined' ||
        !['localhost', '127.0.0.1'].includes(
          window.location.hostname
        )
      ) {
        throw new Error(
          '현재는 localhost에서 실행하는 웹 개발환경에서만 매장 검색이 지원됩니다.'
        );
      }

      // 3. 스마트폰 또는 브라우저 위치 권한 요청
      const permission =
        await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        throw new Error(
          '기기의 위치 접근 권한이 거부됐습니다. 브라우저 설정에서 위치 권한을 허용해주세요.'
        );
      }

      // 4. 실제 GPS 위치 가져오기
      const position =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        throw new Error(
          'GPS 좌표를 확인하지 못했습니다.'
        );
      }

      setCurrentLocation({
        latitude,
        longitude,
      });

      // 5. 카카오맵 로컬 검색 서버 호출
      const responses = await Promise.allSettled(
        SEARCH_KEYWORDS.map(async (keyword) => {
          const url =
            `${API_BASE}/nearby` +
            `?lat=${encodeURIComponent(latitude)}` +
            `&lng=${encodeURIComponent(longitude)}` +
            `&keyword=${encodeURIComponent(keyword)}`;

          const response = await fetch(url);

          if (!response.ok) {
            const details = await response.json()
              .catch(() => ({}));

            throw new Error(
              details.message ||
              details.error ||
              `${keyword} 검색 실패`
            );
          }

          const data = await response.json();

          return {
            keyword,
            places: Array.isArray(data.places)
              ? data.places
              : [],
          };
        })
      );

      // 6. 성공한 검색 결과만 모으기
      const succeeded = responses
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value);

      if (succeeded.length === 0) {
        throw new Error(
          '카카오맵 검색 서버에 연결하지 못했습니다. VS Code에서 node kakao-place-server.js가 실행 중인지 확인해주세요.'
        );
      }

      // 7. 카페, 편의점이 아닌 검색 결과 제거
      const filtered = succeeded.flatMap(
        ({ keyword, places: results }) =>
          results
            .filter((place) =>
              isValidStore(place, keyword)
            )
            .map((place) => ({
              ...place,
              brand: keyword,
            }))
      );

      // 8. 중복 매장 제거
      const uniqueMap = new Map();

      filtered.forEach((place) => {
        if (!uniqueMap.has(String(place.id))) {
          uniqueMap.set(String(place.id), place);
        }
      });

      // 9. 거리순 정렬
      const sorted = Array.from(uniqueMap.values())
        .sort((a, b) => {
          return Number(a.distance) -
            Number(b.distance);
        })
        .slice(0, 30);

      setPlaces(sorted);

      const failedCount =
        responses.length - succeeded.length;

      if (sorted.length === 0) {
        setResultMessage(
          '주변 1km에서 검색 조건에 맞는 매장을 찾지 못했습니다.'
        );
      } else {
        setResultMessage(
          `${sorted.length}개 매장을 찾았습니다.` +
          (
            failedCount > 0
              ? ` 일부 브랜드 ${failedCount}개 검색은 실패했습니다.`
              : ''
          )
        );
      }

    } catch (error) {
      console.warn(
        '주변 매장 검색 오류:',
        error.message
      );

      setErrorMessage(
        error.message ||
        '주변 매장을 검색하지 못했습니다.'
      );
    } finally {
      setLoading(false);
    }
  };

  const openPlace = async (place) => {
    if (!place?.id) return;

    const url =
      `https://place.map.kakao.com/${place.id}`;

    try {
      await Linking.openURL(url);
    } catch {
      setErrorMessage(
        '카카오맵 매장 페이지를 열지 못했습니다.'
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!loading) onClose();
      }}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>

          <Text style={styles.title}>
            📍 내 주변 매장
          </Text>

          <Text style={styles.description}>
            현재 GPS 위치를 기준으로 반경 1km 내
            스타벅스, CU, GS25 매장을 검색합니다.
          </Text>

          <View style={styles.consentBox}>
            <Text style={styles.consentLabel}>
              위치정보 동의 상태
            </Text>

            <Text
              style={[
                styles.consentValue,
                !locationAgreed &&
                  styles.consentNotAgreed,
              ]}
            >
              {locationAgreed
                ? '동의함'
                : '동의하지 않음'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.searchButton,
              loading && styles.disabledButton,
            ]}
            disabled={loading}
            onPress={searchNearby}
          >
            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator
                  color="#FFFFFF"
                  size="small"
                />

                <Text style={styles.searchButtonText}>
                  주변 매장 검색 중...
                </Text>
              </View>
            ) : (
              <Text style={styles.searchButtonText}>
                내 주변 매장 검색
              </Text>
            )}
          </TouchableOpacity>

          {currentLocation && (
            <View style={styles.gpsBox}>
              <Text style={styles.gpsText}>
                GPS 확인 완료
              </Text>

              <Text style={styles.gpsCoordinate}>
                위도: {currentLocation.latitude.toFixed(5)}
              </Text>

              <Text style={styles.gpsCoordinate}>
                경도: {currentLocation.longitude.toFixed(5)}
              </Text>
            </View>
          )}

          {!!errorMessage && (
            <Text style={styles.errorMessage}>
              {errorMessage}
            </Text>
          )}

          {!!resultMessage && (
            <Text style={styles.resultMessage}>
              {resultMessage}
            </Text>
          )}

          {places.length > 0 && (
            <>
              <Text style={styles.listTitle}>
                검색된 주변 매장
              </Text>

              <ScrollView
                style={styles.listScroll}
                contentContainerStyle={
                  styles.listContent
                }
                nestedScrollEnabled
              >
                {places.map((place) => (
                  <TouchableOpacity
                    key={`${place.brand}-${place.id}`}
                    style={styles.placeItem}
                    onPress={() => openPlace(place)}
                  >
                    <View style={styles.placeInfo}>
                      <Text style={styles.placeName}>
                        {place.name}
                      </Text>

                      <Text style={styles.placeAddress}>
                        {place.address}
                      </Text>

                      <Text style={styles.placeBrand}>
                        {place.brand}
                      </Text>
                    </View>

                    <View style={styles.placeRight}>
                      <Text style={styles.placeDistance}>
                        {formatDistance(
                          place.distance
                        )}
                      </Text>

                      <Text style={styles.placeDetail}>
                        상세 보기 ›
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.privacyNotice}>
            검색 시 현재 좌표가 로컬 검색 서버를
            거쳐 카카오맵 API에 전달됩니다.
            SOL페이는 좌표를 별도로 저장하지 않습니다.
          </Text>

          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={styles.closeButtonText}>
              닫기
            </Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    maxHeight: '90%',
  },

  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#142C55',
  },

  description: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    color: '#67768E',
  },

  consentBox: {
    marginTop: 15,
    padding: 12,
    backgroundColor: '#F1F5FB',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  consentLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#506481',
  },

  consentValue: {
    fontSize: 12,
    fontWeight: '900',
    color: '#245DE5',
  },

  consentNotAgreed: {
    color: '#D65A42',
  },

  searchButton: {
    marginTop: 15,
    backgroundColor: '#245DE5',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },

  disabledButton: {
    opacity: 0.65,
  },

  searchButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  gpsBox: {
    marginTop: 12,
    borderRadius: 10,
    padding: 11,
    backgroundColor: '#EAF7EE',
  },

  gpsText: {
    color: '#237542',
    fontSize: 12,
    fontWeight: '900',
  },

  gpsCoordinate: {
    color: '#35704B',
    fontSize: 11,
    marginTop: 3,
  },

  errorMessage: {
    marginTop: 12,
    color: '#C53D3D',
    fontSize: 12,
    lineHeight: 19,
  },

  resultMessage: {
    marginTop: 12,
    color: '#245DE5',
    fontSize: 12,
    fontWeight: '800',
  },

  listTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#203752',
    marginTop: 16,
    marginBottom: 8,
  },

  listScroll: {
    maxHeight: 240,
  },

  listContent: {
    paddingBottom: 10,
  },

  placeItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E6EBF2',
  },

  placeInfo: {
    flex: 1,
    paddingRight: 10,
  },

  placeName: {
    fontSize: 13,
    fontWeight: '900',
    color: '#20314D',
  },

  placeAddress: {
    fontSize: 11,
    marginTop: 5,
    color: '#64758C',
  },

  placeBrand: {
    fontSize: 10,
    marginTop: 4,
    color: '#2C60CB',
  },

  placeRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },

  placeDistance: {
    fontSize: 12,
    fontWeight: '900',
    color: '#245DE5',
  },

  placeDetail: {
    fontSize: 10,
    color: '#72839A',
    marginTop: 5,
  },

  privacyNotice: {
    marginTop: 13,
    fontSize: 10,
    lineHeight: 16,
    color: '#8793A6',
  },

  closeButton: {
    alignItems: 'center',
    paddingVertical: 13,
    marginTop: 7,
  },

  closeButtonText: {
    color: '#566B88',
    fontSize: 13,
    fontWeight: '800',
  },
});
