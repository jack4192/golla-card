import React from 'react';
import { Text, View } from 'react-native';
export default function DemoConfetti() {
  return <View pointerEvents="none" style={{
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 15
  }}>
      <Text style={{
      fontSize: 31
    }}>🎉 🎊 🎉</Text>
    </View>;
}
