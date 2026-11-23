// Fix for the specific Amplify static-hosting _expo JS 404 seen in this demo.
// It copies ONLY the HTML's JS entry to web-root and rewrites index.html.
// It does not modify Expo source or attempt to proxy external APIs.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const htmlPath = path.join(dist, 'index.html');
if (!fs.existsSync(htmlPath)) throw new Error('dist/index.html이 없습니다. Expo 웹 빌드부터 실행하세요.');
let html = fs.readFileSync(htmlPath, 'utf8');
const matches = [...html.matchAll(/\/?_expo\/static\/js\/web\/[a-zA-Z0-9_.-]+\.js/g)];
const unique = [...new Set(matches.map(m => m[0]))];
if (!unique.length) {
  console.log('JS 경로 변환 없음: index.html이 다른 구조입니다. dist를 확인하세요.');
} else {
  for (const url of unique) {
    const relative = url.replace(/^\//, '');
    const source = path.join(dist, ...relative.split('/'));
    if (!fs.existsSync(source)) throw new Error('필요한 JS 파일이 없음: ' + source);
    const targetName = 'solpay-' + path.basename(source);
    fs.copyFileSync(source, path.join(dist, targetName));
    html = html.split(url).join('/' + targetName);
    console.log(`${relative} → ${targetName}`);
  }
  fs.writeFileSync(htmlPath, html, 'utf8');
}
console.log('Amplify 빌드 파일 준비 완료');
