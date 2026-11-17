const fs = require('fs');
const path = require('path');

const packageJsonContent = `{
  "name": "paymate",
  "version": "1.0.0",
  "main": "node_modules/expo/AppEntry.js",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web"
  },
  "dependencies": {
    "expo": "~50.0.14",
    "expo-status-bar": "~1.11.1",
    "react": "18.2.0",
    "react-native": "0.73.6",
    "expo-secure-store": "~12.8.1",
    "expo-brightness": "~11.8.1",
    "expo-screen-capture": "~5.8.1",
    "expo-notifications": "~0.27.6",
    "axios": "^1.6.8",
    "react-navigation": "^4.4.4"
  },
  "devDependencies": {
    "@babel/core": "^7.20.0"
  },
  "private": true
}`;

// package.json 덮어쓰기
fs.writeFileSync(path.join(__dirname, 'package.json'), packageJsonContent, 'utf8');
console.log('✅ package.json 업데이트 완료 (화면보호, 보안저장소 패키지 추가)');
console.log('🎉 이제 터미널에 [ npm install ]을 입력해서 패키지를 설치하세요!');