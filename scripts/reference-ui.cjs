const fs = require('node:fs');
const babel = require('@babel/core');
const main = 'screens/MainScreen.js';
const agenda = 'components/SpecialScheduleModal.js';
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let m = read(main), a = read(agenda);
if (m.includes('styles.walletStage') && a.includes('s.agendaEntry')) {
  console.log('이미 적용되었습니다.');
  process.exit(0);
}
function section(text, start, end) {
  const i = text.indexOf(start), j = text.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw Error('화면 버전을 확인해주세요. ' + start);
  return text.slice(i, j);
}
const oldHero = section(m, '<View style={styles.hero}>', '{appNotice');
const notice = section(m, '{appNotice', '<View style={styles.sectionHeader}>');
const pay = section(m, '<TouchableOpacity style={styles.payShortcut}', '    </>;');
m = m.replace(oldHero, '').replace(notice, '').replace(pay, '')
  .replace('<Text style={styles.sectionTitle}>내 지갑</Text>',
    '<View><Text style={styles.kicker}>내 지갑 · {walletCards.length}장</Text><Text style={styles.lead}>오늘 사용할 카드</Text></View>')
  .replace('{wallet()}\n      {walletBenefitSummary()}',
    '{wallet()}\n' + pay.replace('바코드 / QR 현장 결제','선택한 카드로 결제') +
    '\n{walletBenefitSummary()}\n<MyDataCardStatus card={currentCard} />\n' + notice)
  .replace('<><MyDataCardStatus card={currentCard} />{renderHome()}</>', 'renderHome()')
  .replace(/<Text style=\{styles.brandCaption\}>\s*SMART SAVING AGENT\s*<\/Text>/, '')
  .replace('style={styles.navItem}', 'accessibilityRole="tab" accessibilityState={{selected: active}} style={[styles.navItem, active && styles.activeTab]}')
  .replaceAll('maxWidth: 1040', 'maxWidth: 760');
const catalog = section(m, '      <Text style={{\n      fontSize: 18', '      <Text style={{\n      fontSize: 18,\n      fontWeight: "800",\n      marginTop: 20');
if (!catalog.includes('카드 이름이나 혜택 검색')) throw Error('상품 목록 위치를 확인해주세요.');
m = m.replace(catalog, '');
const cardsIntro = section(m, '      <Text style={{\n      fontSize: 18,\n      fontWeight: "800",\n      marginTop: 20', '      {walletCards.map');
m = m.replace(cardsIntro, `      <View style={styles.walletStage}>
        <Text style={styles.walletCount}>보유 카드 {walletCards.length}장</Text>
        <Text style={styles.walletHeading}>내 지갑</Text>
        <WalletProductCard card={currentCard} onPress={() => selectTab('payment')} />
      </View>
      <Text style={styles.sectionTitle}>내 카드 목록</Text>
`).replace('    </>;\n  const renderSettings', catalog + '    </>;\n  const renderSettings');
m = m.replace(/<Text style=\{styles.pageEyebrow\}>BENEFIT CENTER[\s\S]*?<View style=\{styles.searchBox\}>/,
`<Text style={styles.lead}>혜택 둘러보기</Text>
      <View style={styles.report}>
        <Text style={styles.kicker}>등록된 혜택</Text>
        <Text style={styles.total}>{ALL_BENEFITS.length}건</Text>
        {['이벤트', '마이샵'].map(group => {
          const count = ALL_BENEFITS.filter(item => item.type === group).length;
          return <View key={group} style={{gap: 5}}>
            <Text style={styles.reportLabel}>{group} · {count}건</Text>
            <View style={styles.track}><View style={{height: 7, backgroundColor: '#2464ED',
              width: (100 * count / Math.max(1, ALL_BENEFITS.length)) + '%'}} /></View>
          </View>;
        })}
      </View>
      <View style={styles.searchBox}>`);
m = m.replace('const styles = StyleSheet.create({', `const styles = StyleSheet.create({
  kicker: {fontSize: 14, color: '#506788', fontWeight: '600', marginBottom: 4},
  lead: {fontSize: 30, lineHeight: 39, fontWeight: '800', color: '#101F39'},
  walletStage: {backgroundColor: '#101F4B', borderRadius: 26, padding: 20, gap: 6},
  walletCount: {fontSize: 14, color: '#B9CDF1'},
  walletHeading: {fontSize: 30, color: 'white', fontWeight: '800', marginBottom: 14},
  report: {backgroundColor: '#EDF4FF', borderRadius: 22, padding: 20, gap: 10},
  total: {fontSize: 38, fontWeight: '800', color: '#164ED3'},
  reportLabel: {fontSize: 14, fontWeight: '600', color: '#283C58'},
  track: {height: 7, borderRadius: 5, backgroundColor: '#D4E1F6', overflow: 'hidden'},
  activeTab: {borderTopWidth: 3, borderTopColor: '#205DE5'},
`).replace('backgroundColor: "#F4F7FB"', 'backgroundColor: "#FAFBFE"');
a = a.replace('<Text style={s.title}>오늘은 어떤 일정이 있나요?</Text>', '<Text style={s.title}>나의 일정</Text>')
  .replace('{date} · 등록 일정 {list.length}건', '{date} · 일정 {list.length}건')
  .replace('key={event.id} style={s.card}', 'key={event.id} style={[s.card, s.agendaEntry]}')
  .replace('const s = StyleSheet.create({', `const s = StyleSheet.create({
  agendaEntry: {borderLeftWidth: 4, borderLeftColor: '#2464ED', backgroundColor: '#F1F6FF'},`);
for (const [file, source] of [[main,m],[agenda,a]]) {
  babel.parseSync(source,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});
  if (!fs.existsSync(file + '.before-reference.bak')) fs.copyFileSync(file,file + '.before-reference.bak');
}
fs.writeFileSync(main,m); fs.writeFileSync(agenda,a);
console.log('홈·지갑·혜택·일정 디자인 적용 완료');

