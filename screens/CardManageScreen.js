import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Alert } from '../utils/demoAlert';

// PDF에서 추출한 국민카드 5종의 실제 혜택 데이터
const CARD_DATABASE = [{
  id: 1,
  name: 'KB국민 K-패스체크카드',
  type: '체크',
  desc: '대중교통 10%, 생활(편의점/커피) 1% 적립',
  tags: ['교통', '편의점', '커피'],
  highlight: '대중교통 10% 적립'
}, {
  id: 2,
  name: 'KB Youth Club 체크카드',
  type: '체크',
  desc: '선택형 할인(배달, 카페, 편의점, OTT 등)',
  tags: ['식비', '배달', '교통', '편의점', 'OTT'],
  highlight: '배달/편의점 등 맞춤형 혜택'
}, {
  id: 3,
  name: 'KB ALL 카드',
  type: '신용',
  desc: '전 가맹점 1% 할인, 쇼핑/OTT/통신 자동납부 할인',
  tags: ['무조건', '통신', 'OTT', '쇼핑'],
  highlight: '실적 조건 없는 무조건 할인'
}, {
  id: 4,
  name: 'KB YOU Prime 카드',
  type: '신용',
  desc: '일상팩/가족팩 선택 (배달, 주유, 장보기 등 10% 할인)',
  tags: ['식비', '배달', '장보기', '주유', '통신'],
  highlight: '배달 및 온라인 장보기 특화'
}, {
  id: 5,
  name: 'KB국민 굿데이카드',
  type: '신용',
  desc: '주유, 통신, 대중교통, 음식점, 커피 10% 할인',
  tags: ['식비', '음식점', '커피', '주유', '교통', '통신'],
  highlight: '일반 음식점 10% 청구할인'
}];
export default function CardManageScreen({
  onNext,
  onBack
}) {
  const [search, setSearch] = useState('');
  const handleAddCard = cardName => {
    Alert.alert('카드 등록 완료', `${cardName}이(가) SOL-Pay에 성공적으로 등록되었습니다!`);
  };

  // 검색어에 따른 필터링 (카드명 또는 태그)
  const filteredCards = CARD_DATABASE.filter(card => card.name.includes(search) || card.tags.some(tag => tag.includes(search)));

  // 마이데이터 분석(식비 특화)에 따른 추천 카드 3개 뽑기 (태그에 식비, 배달, 음식점이 있는 카드)
  const recommendedCards = CARD_DATABASE.filter(card => card.tags.includes('식비') || card.tags.includes('배달') || card.tags.includes('음식점')).slice(0, 3);

  // 검색어가 있을 때는 검색 결과를, 없을 때는 추천 카드를 보여줌
  const displayCards = search.trim() !== '' ? filteredCards : recommendedCards;
  return <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backBtnText}>← 뒤로</Text>
        </TouchableOpacity>
      </View>

      <View style={{
      flex: 1
    }}>
        <Text style={styles.title}>카드 관리 및 추가</Text>
        <Text style={styles.subtitle}>마이데이터 분석을 바탕으로 최적의 카드를 추천해드려요.</Text>
        
        <TextInput style={styles.searchInput} placeholder="카드명 또는 혜택 (예: 교통, 식비, 무조건) 검색" value={search} onChangeText={setSearch} />

        <Text style={styles.sectionTitle}>
          {search.trim() !== '' ? `🔍 '${search}' 검색 결과` : '✨ 승범님의 최근 소비(식비) 맞춤 추천'}
        </Text>
        
        <ScrollView showsVerticalScrollIndicator={false}>
          {displayCards.map(card => <View key={card.id} style={styles.cardItem}>
              {/* 이미지 들어갈 빈 네모칸 */}
              <View style={styles.imagePlaceholder}>
                <Text style={styles.placeholderText}>이미지</Text>
              </View>

              <View style={{
            flex: 1,
            marginLeft: 15
          }}>
                <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 3
            }}>
                  <Text style={styles.cardTypeBadge}>{card.type}</Text>
                  <Text style={styles.cardName}>{card.name}</Text>
                </View>
                <Text style={styles.cardHighlight}>{card.highlight}</Text>
                <Text style={styles.cardDesc}>{card.desc}</Text>
              </View>

              <TouchableOpacity style={styles.btnAdd} onPress={() => handleAddCard(card.name)}>
                <Text style={styles.btnAddText}>등록</Text>
              </TouchableOpacity>
            </View>)}
          {displayCards.length === 0 && <Text style={{
          textAlign: 'center',
          color: '#888',
          marginTop: 20
        }}>검색 결과가 없습니다.</Text>}
        </ScrollView>
      </View>
      
      <TouchableOpacity style={styles.btnPrimary} onPress={onNext}>
        <Text style={styles.btnText}>결제 탭으로 이동하기</Text>
      </TouchableOpacity>
    </View>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 22,
    backgroundColor: "#F4F7FB",
    width: "100%",
    maxWidth: 760,
    alignSelf: "center"
  },
  header: {
    marginTop: 16,
    marginBottom: 20
  },
  backBtnText: {
    fontSize: 16,
    color: '#666',
    fontWeight: 'bold'
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#142D4E",
    marginBottom: 10,
    lineHeight: 39
  },
  subtitle: {
    fontSize: 14,
    color: "#5A6E89",
    marginBottom: 20,
    lineHeight: 24
  },
  searchInput: {
    width: '100%',
    padding: 15,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 14,
    fontSize: 16,
    backgroundColor: "#FFFFFF",
    minHeight: 52,
    color: "#142D4E"
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a237e',
    marginBottom: 15
  },
  cardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 20,
    marginBottom: 12,
    backgroundColor: "#FFFFFF"
  },
  imagePlaceholder: {
    width: 50,
    height: 75,
    backgroundColor: '#e9ecef',
    borderRadius: 5,
    justifyContent: 'center',
    alignItems: 'center'
  },
  placeholderText: {
    color: '#adb5bd',
    fontSize: 12
  },
  cardTypeBadge: {
    backgroundColor: '#e8eaf6',
    color: '#1a237e',
    fontSize: 12,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6
  },
  cardName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333'
  },
  cardHighlight: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#e53935',
    marginBottom: 2
  },
  cardDesc: {
    fontSize: 12,
    color: '#888'
  },
  btnAdd: {
    backgroundColor: '#1a237e',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginLeft: 5,
    minHeight: 44,
    justifyContent: "center"
  },
  btnAddText: {
    color: "#FFFFFF",
    fontWeight: 'bold',
    fontSize: 14
  },
  btnPrimary: {
    width: '100%',
    padding: 16,
    backgroundColor: "#245DE5",
    borderRadius: 16,
    alignItems: "center",
    marginBottom: 20,
    marginTop: 10,
    minHeight: 54,
    justifyContent: "center"
  },
  btnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  }
});
