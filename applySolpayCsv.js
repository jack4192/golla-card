
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const root = process.cwd();
const mainFile = path.join(root, 'screens', 'MainScreen.js');
const csvFile = path.join(root, 'data', 'cardCatalogCsv.js');
const filename = '신한_국민_데이터.zip';

const sources = [
  path.join(root, filename),
  path.join(os.homedir(), 'Downloads', filename),
  path.join(os.homedir(), 'Desktop', filename),
];

const zipPath = sources.find(fs.existsSync);

if (!fs.existsSync(mainFile)) {
  throw new Error(
    '프로젝트 폴더에서 실행해야 합니다. screens/MainScreen.js를 찾지 못했습니다.'
  );
}

if (!zipPath) {
  throw new Error(
    `${filename} 파일을 프로젝트 폴더에 복사한 뒤 다시 실행하세요.`
  );
}

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), 'solpay-csv-')
);

function readCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  text = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;

      row.push(field);

      if (row.some(x => x !== '')) {
        rows.push(row);
      }

      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field);

  if (row.some(x => x !== '')) {
    rows.push(row);
  }

  const [headers, ...body] = rows;

  return body.map(r =>
    Object.fromEntries(
      headers.map((h, i) => [h, r[i] || ''])
    )
  );
}

const num = v =>
  v === '' || v == null ? null : Number(v);

const required = (text, fragment) => {
  if (!text.includes(fragment)) {
    throw new Error(
      `MainScreen.js 구조 확인 실패: ${fragment}`
    );
  }
};

try {
  const cmd =
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' ` +
    `-DestinationPath '${temp.replace(/'/g, "''")}' -Force`;

  if (process.platform === 'win32') {
    cp.execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', cmd],
      { stdio: 'pipe' }
    );
  } else {
    cp.execFileSync(
      'unzip',
      ['-oq', zipPath, '-d', temp],
      { stdio: 'pipe' }
    );
  }

  const load = name =>
    readCsv(
      fs.readFileSync(
        path.join(temp, name),
        'utf8'
      )
    );

  const cards = load('card.csv');
  const benefits = load('benefit.csv');
  const rules = load('card_benefit.csv');
  const tiers = load('card_cap_tier.csv');

  const benefitById = Object.fromEntries(
    benefits.map(b => [b.benefit_id, b])
  );

  const catalog = cards.map(c => ({
    id: c.card_id,
    code: c.card_code,
    issuer: c.issuer_code === 'SHINHAN'
      ? '신한카드'
      : 'KB국민카드',
    name: c.name,
    type: c.card_type === 'CREDIT'
      ? '신용'
      : '체크',
    annualFee: num(c.annual_fee),
    description: c.description,
    tags: c.tags.split(';').filter(Boolean),

    benefits: rules
      .filter(r => r.card_id === c.card_id)
      .map(r => ({
        benefitId: r.benefit_id,
        name: benefitById[r.benefit_id]?.name || '혜택',
        type: r.benefit_type,
        rate: num(r.rate),
        fixedAmount: num(r.fixed_amount),
        minPrevSpend: num(r.min_prev_spend),
        monthlyCap: num(r.monthly_cap),
        maxPerTx: num(r.max_per_tx),
        minAmountPerTx: num(r.min_amount_per_tx),
        dailyCountCap: num(r.daily_count_cap),
        monthlyCountCap: num(r.monthly_count_cap),
        timeStart: r.time_start,
        timeEnd: r.time_end,
        dayCondition: r.day_condition,
        capGroup: r.cap_group,
        brandScope: r.brand_scope,
        note: r.note,
      })),

    tiers: tiers
      .filter(t => t.card_id === c.card_id)
      .map(t => ({
        capGroup: t.cap_group,
        minPrevSpend: num(t.min_prev_spend),
        monthlyCap: num(t.monthly_cap),
        unit: t.unit,
        note: t.note,
      })),
  }));

  if (catalog.length !== 22 || rules.length !== 306) {
    throw new Error(
      `CSV 데이터 수량 불일치: 카드 ${catalog.length}종, 혜택 ${rules.length}건`
    );
  }

  const newData =
    '// 신한_국민_데이터.zip에서 생성된 카드 데이터\n' +
    'export const CSV_CARD_CATALOG = ' +
    JSON.stringify(catalog, null, 2) +
    ';\n' +
    'export const getCatalogCardForWallet = card =>\n' +
    "  card?.id === 'solmate'\n" +
    "    ? CSV_CARD_CATALOG.find(c => c.code === 'SH_SOLMATE_SOL_PLAN_CHECK')\n" +
    '    : null;\n';

  let main = fs.readFileSync(mainFile, 'utf8');

  if (
    main.includes('SOLPAY_CSV_CATALOG_V1') ||
    main.includes("from '../data/cardCatalogCsv'")
  ) {
    fs.writeFileSync(csvFile, newData, 'utf8');
    console.log(
      'CSV 데이터 갱신 완료. 화면 연결은 이미 적용된 상태입니다.'
    );
    process.exit(0);
  }

  const importAnchor =
    "import PaymentScreen from './PaymentScreen';";

  const stateAnchor =
    "  const [tab, setTab] = useState('home');";

  const homeAnchor =
    main.includes('      {walletBenefitSummary()}')
      ? '      {walletBenefitSummary()}'
      : '      {wallet()}';

  const cardsAnchor =
    '  const renderCards = () => (\n    <>\n';

  const endAnchor =
    '\n    </SafeAreaView>\n  );\n}\n';

  [
    importAnchor,
    stateAnchor,
    homeAnchor,
    cardsAnchor,
    endAnchor,
  ].forEach(a => required(main, a));

  main = main.replace(
    importAnchor,
    `${importAnchor}
import {
  CSV_CARD_CATALOG,
  getCatalogCardForWallet,
} from '../data/cardCatalogCsv'; // SOLPAY_CSV_CATALOG_V1`
  );

  main = main.replace(
    stateAnchor,
    `${stateAnchor}
  const [catalogQuery, setCatalogQuery] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState(null);`
  );

  const homeButton = `
      <TouchableOpacity
        onPress={() => selectTab('cards')}
        style={{
          backgroundColor: '#EAF1FF',
          padding: 14,
          borderRadius: 14,
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text
            style={{
              color: '#204CA2',
              fontWeight: '800',
            }}
          >
            신한·국민 카드 22종 혜택 보기
          </Text>
          <Text
            style={{
              color: '#607DAC',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            카드별 혜택 조건 306건
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={19}
          color="#204CA2"
        />
      </TouchableOpacity>

      {getCatalogCardForWallet(currentCard) && (
        <TouchableOpacity
          onPress={() =>
            setSelectedCatalog(
              getCatalogCardForWallet(currentCard)
            )
          }
          style={{
            padding: 12,
            marginTop: 9,
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
          }}
        >
          <Text
            style={{
              color: '#235CEA',
              fontWeight: '700',
            }}
          >
            SOL메이트 카드의 CSV 혜택 자세히 보기
          </Text>
        </TouchableOpacity>
      )}
`;

  main = main.replace(
    homeAnchor,
    homeAnchor + homeButton
  );

  const catalogSection = `
      <Text
        style={{
          fontSize: 18,
          fontWeight: '900',
          color: '#203251',
          marginBottom: 8,
        }}
      >
        신한·국민 카드 상품 22종
      </Text>

      <Text
        style={{
          color: '#6C7C94',
          fontSize: 12,
          marginBottom: 12,
        }}
      >
        상품 정보 조회용이며 실제 보유 카드와는 별개입니다.
      </Text>

      <TextInput
        placeholder="카드 이름이나 혜택 검색"
        value={catalogQuery}
        onChangeText={setCatalogQuery}
        style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1,
          borderColor: '#E2E8F2',
          padding: 12,
          borderRadius: 12,
          marginBottom: 12,
        }}
      />

      {CSV_CARD_CATALOG.filter(c =>
        (
          c.name + ' ' +
          c.description + ' ' +
          c.tags.join(' ')
        )
          .toLowerCase()
          .includes(catalogQuery.trim().toLowerCase())
      ).map(c => (
        <TouchableOpacity
          key={c.code}
          onPress={() => setSelectedCatalog(c)}
          style={{
            backgroundColor: '#FFFFFF',
            padding: 14,
            borderRadius: 14,
            marginBottom: 8,
            borderWidth: 1,
            borderColor: '#E6EBF4',
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: '800',
              color: '#1D304D',
            }}
          >
            {c.name}
          </Text>
          <Text
            style={{
              fontSize: 11,
              color: '#687A96',
              marginTop: 5,
            }}
          >
            {c.issuer} · {c.type} · 혜택 {c.benefits.length}건
          </Text>
          <Text
            numberOfLines={2}
            style={{
              fontSize: 11,
              color: '#687A96',
              marginTop: 6,
            }}
          >
            {c.description}
          </Text>
        </TouchableOpacity>
      ))}

      <Text
        style={{
          fontSize: 18,
          fontWeight: '900',
          marginTop: 20,
          marginBottom: 15,
          color: '#203251',
        }}
      >
        내 지갑 카드
      </Text>
`;

  main = main.replace(
    cardsAnchor,
    cardsAnchor + catalogSection
  );

  const catalogModal = `
      <Modal
        visible={!!selectedCatalog}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCatalog(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15,28,52,0.55)',
            justifyContent: 'center',
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 20,
              maxHeight: '85%',
            }}
          >
            <ScrollView
              contentContainerStyle={{ padding: 20 }}
            >
              {selectedCatalog && (
                <>
                  <Text
                    style={{
                      fontSize: 19,
                      fontWeight: '900',
                      color: '#1E3150',
                    }}
                  >
                    {selectedCatalog.name}
                  </Text>

                  <Text
                    style={{
                      fontSize: 12,
                      color: '#62738E',
                      marginTop: 8,
                      marginBottom: 14,
                    }}
                  >
                    {selectedCatalog.description}
                  </Text>

                  {selectedCatalog.benefits.map((b, i) => (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 11,
                        borderBottomWidth: 1,
                        borderBottomColor: '#EDF1F7',
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: '700',
                          color: '#1D304D',
                        }}
                      >
                        {b.name}
                      </Text>

                      <Text
                        style={{
                          color: '#245DEA',
                          fontWeight: '800',
                          marginTop: 4,
                        }}
                      >
                        {b.rate != null
                          ? (Math.round(b.rate * 10000) / 100) + '%'
                          : b.fixedAmount != null
                            ? b.fixedAmount.toLocaleString('ko-KR') +
                              (b.type === 'POINT' ? 'P' : '원')
                            : '부가 혜택'} · {b.type}
                      </Text>

                      <Text
                        style={{
                          color: '#6B7990',
                          fontSize: 11,
                          marginTop: 5,
                        }}
                      >
                        {b.minPrevSpend == null
                          ? '실적 조건 미기재'
                          : b.minPrevSpend === 0
                            ? '전월 실적 없음'
                            : '전월 ' +
                              b.minPrevSpend.toLocaleString('ko-KR') +
                              '원 이상'}
                        {b.monthlyCap != null
                          ? ' · 월 한도 ' +
                            b.monthlyCap.toLocaleString('ko-KR')
                          : ''}
                      </Text>

                      {!!b.note && (
                        <Text
                          style={{
                            color: '#8894A6',
                            fontSize: 11,
                            marginTop: 4,
                          }}
                        >
                          {b.note}
                        </Text>
                      )}
                    </View>
                  ))}

                  {!!selectedCatalog.tiers.length && (
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '900',
                        marginTop: 16,
                      }}
                    >
                      실적별 한도
                    </Text>
                  )}

                  {selectedCatalog.tiers.map((t, i) => (
                    <Text
                      key={i}
                      style={{
                        color: '#5B6D85',
                        fontSize: 12,
                        lineHeight: 20,
                        marginTop: 8,
                      }}
                    >
                      {t.capGroup} · 전월{' '}
                      {Number(t.minPrevSpend).toLocaleString('ko-KR')}원
                      이상 ·{' '}
                      {Number(t.monthlyCap).toLocaleString('ko-KR')}{' '}
                      {t.unit}
                    </Text>
                  ))}

                  <Text
                    style={{
                      color: '#96A1B1',
                      fontSize: 11,
                      marginTop: 15,
                    }}
                  >
                    실제 실적·잔여 한도와 혜택 적용은
                    확인되지 않은 시연용 화면입니다.
                  </Text>
                </>
              )}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setSelectedCatalog(null)}
              style={{
                backgroundColor: '#245DEA',
                padding: 14,
                alignItems: 'center',
                margin: 15,
                borderRadius: 12,
              }}
            >
              <Text
                style={{
                  color: '#FFFFFF',
                  fontWeight: '800',
                }}
              >
                닫기
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
`;

  main = main.replace(
    endAnchor,
    catalogModal + endAnchor
  );

  fs.copyFileSync(
    mainFile,
    mainFile + '.backup.js'
  );

  fs.writeFileSync(
    csvFile,
    newData,
    'utf8'
  );

  fs.writeFileSync(
    mainFile,
    main,
    'utf8'
  );

  console.log(
    `완료! 카드 ${catalog.length}종, 혜택 ${rules.length}건, 한도 ${tiers.length}건을 연결했습니다.`
  );

  console.log(
    '이제 npx expo start --web -c 로 실행하세요.'
  );

} finally {
  fs.rmSync(temp, {
    recursive: true,
    force: true,
  });
}
