// Prepares dist/ (from `npx expo export --platform web`) for a Vercel static deploy.
// Vercel's CLI never uploads folders named node_modules, but Expo puts icon fonts
// under dist/assets/node_modules. Move them to dist/assets/nm and add a rewrite so
// the original URLs keep working. Also adds an SPA fallback to index.html.
const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error('dist/index.html이 없습니다. 먼저 npx expo export --platform web 을 실행하세요.');
}

const from = path.join(dist, 'assets', 'node_modules');
const to = path.join(dist, 'assets', 'nm');
if (fs.existsSync(from)) {
  fs.rmSync(to, { recursive: true, force: true });
  // copy + delete instead of rename: Windows often refuses renaming folders with EPERM
  fs.cpSync(from, to, { recursive: true });
  fs.rmSync(from, { recursive: true, force: true });
}

const config = {
  rewrites: [
    { source: '/assets/node_modules/:path*', destination: '/assets/nm/:path*' },
    { source: '/((?!_expo/|assets/|favicon).*)', destination: '/index.html' },
  ],
};
fs.writeFileSync(path.join(dist, 'vercel.json'), JSON.stringify(config, null, 2));
console.log('Vercel 배포 파일 준비 완료');
