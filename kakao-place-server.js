
const http = require('node:http');

const API_KEY = process.env.KAKAO_REST_API_KEY;

const PORT = 3030;

const ALLOWED_KEYWORDS = [
  '스타벅스',
  'CU',
  'GS25',
  '이디야',
  '투썸플레이스',
  '세븐일레븐',
];

if (!API_KEY) {
  console.error('카카오 REST API 키가 설정되지 않았습니다.');
  process.exit(1);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });

  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // 로컬 개발 서버에서만 호출 허용
  const origin = req.headers.origin;

  if (
    origin &&
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      error: '허용되지 않은 요청 방식입니다.',
    });
  }

  const requestUrl = new URL(
    req.url,
    `http://127.0.0.1:${PORT}`
  );

  if (requestUrl.pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      message: 'SOL페이 카카오맵 서버 정상 실행 중',
    });
  }

  if (requestUrl.pathname !== '/nearby') {
    return sendJson(res, 404, {
      error: '존재하지 않는 경로입니다.',
    });
  }

  const latText = requestUrl.searchParams.get('lat');
  const lngText = requestUrl.searchParams.get('lng');

  const latitude = Number(latText);
  const longitude = Number(lngText);

  const keyword =
    requestUrl.searchParams.get('keyword') || '스타벅스';

  // GPS 좌표 검증
  if (
    latText === null ||
    lngText === null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return sendJson(res, 400, {
      error: '올바른 위도와 경도가 필요합니다.',
    });
  }

  // 사용 가능한 검색어 제한
  if (!ALLOWED_KEYWORDS.includes(keyword)) {
    return sendJson(res, 400, {
      error: '지원하지 않는 검색어입니다.',
    });
  }

  try {
    const kakaoUrl = new URL(
      'https://dapi.kakao.com/v2/local/search/keyword.json'
    );

    kakaoUrl.searchParams.set('query', keyword);
    kakaoUrl.searchParams.set('x', String(longitude));
    kakaoUrl.searchParams.set('y', String(latitude));
    kakaoUrl.searchParams.set('radius', '1000');
    kakaoUrl.searchParams.set('sort', 'distance');
    kakaoUrl.searchParams.set('size', '15');

    const response = await fetch(kakaoUrl, {
      headers: {
        Authorization: `KakaoAK ${API_KEY}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    const result = await response.json();

    if (!response.ok) {
      return sendJson(res, 502, {
        error: '카카오맵 API 요청 실패',
        kakaoStatus: response.status,
        message: result.msg || result.message || 'API 설정을 확인해주세요.',
      });
    }

    const places = (result.documents || []).map((place) => ({
      id: place.id,
      name: place.place_name,
      address: place.road_address_name || place.address_name,
      distance: Number(place.distance),
      latitude: Number(place.y),
      longitude: Number(place.x),
      category: place.category_name,
      placeUrl: place.place_url,
    }));

    sendJson(res, 200, {
      keyword,
      radius: 1000,
      count: places.length,
      places,
    });

  } catch (error) {
    console.error('카카오맵 검색 실패:', error.message);

    sendJson(res, 500, {
      error: '주변 매장을 검색하지 못했습니다.',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('SOL페이 카카오맵 검색 서버 실행 완료');
  console.log(`http://127.0.0.1:${PORT}/health`);
  console.log('');
});
