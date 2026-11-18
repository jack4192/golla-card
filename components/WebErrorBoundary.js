import React from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
export default class WebErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null
    };
  }
  static getDerivedStateFromError(error) {
    return {
      error
    };
  }
  componentDidCatch(error, info) {
    console.error('SOL-Pay demo rendering failed', error, info);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ScrollView contentContainerStyle={{
      flexGrow: 1,
      justifyContent: 'center',
      padding: 25,
      backgroundColor: "#F4F7FB"
    }}>
        <Text style={{
        fontSize: 22,
        fontWeight: "800",
        color: '#153E8C',
        marginBottom: 12
      }}>웹 시연 화면을 열지 못했어요</Text>
        <Text style={{
        fontSize: 13,
        color: '#465878',
        marginBottom: 12
      }}>새로고침 후에도 문제가 있으면 F12 → Console의 오류를 확인해 주세요.</Text>
        <Text selectable style={{
        fontSize: 12,
        color: '#C63333',
        marginBottom: 24
      }}>{String(this.state.error?.message || '알 수 없는 오류')}</Text>
        {Platform.OS === 'web' && <TouchableOpacity onPress={() => window.location.reload()} style={{
        backgroundColor: '#215BE4',
        borderRadius: 10,
        padding: 14,
        alignItems: 'center'
      }}>
            <Text style={{
          color: "#FFFFFF",
          fontWeight: "800"
        }}>다시 불러오기</Text>
          </TouchableOpacity>}
      </ScrollView>;
  }
}
