const fs = require('node:fs');
const babel = require('@babel/core');
const files = ['App.js','screens/MainScreen.js','components/TodaySchedulePanel.js','components/WalletProductCard.js','components/WalletWheelControls.js'];
const originals = files.map(f => fs.readFileSync(f,'utf8'));
let [app,main,panel,card,wheel] = originals.map(s => s.replace(/\r\n/g,'\n'));
if (main.includes("id: 'schedule'") && app.includes('schedulePanel={')) {
  console.log('이미 적용되어 있습니다.');
  process.exit(0);
}
function change(text, pattern, replacement) {
  if (!text.match(pattern)) throw Error('현재 버전에서 위치를 찾지 못했습니다: ' + pattern);
  return text.replace(pattern,replacement);
}
// 일반 홈과 개발자 홈이 가진 일정 콜백을 각각 그대로 전달한다.
const panels = /(<TodaySchedulePanel\b[\s\S]*?\/>)(\s*)<MainScreen\b/g;
if ([...app.matchAll(panels)].length !== 2) throw Error('홈 연결 두 곳을 확인해주세요.');
app = app.replace(panels, (_,p) => '<MainScreen schedulePanel={' + p + '}');
main = change(main,/function MainScreen\(\{/, 'function MainScreen({\n  schedulePanel,');
main = change(main,/id: 'finance',\s*label: '금융',\s*icon: 'pie-chart-outline',\s*active: 'pie-chart'/,
  "id: 'schedule', label: '오늘의 일정', icon: 'calendar-outline', active: 'calendar'");
main = change(main,/<View style=\{styles.mainArea\}>/, `<View style={styles.mainArea}>
        {schedulePanel && React.cloneElement(schedulePanel, {showPage: tab === 'schedule' && !settingsOpen})}`);
main = change(main,/: <ScrollView key=\{tab\}/, ": tab === 'schedule' ? null : <ScrollView key={tab}");
main = change(main,/<View><Text style=\{styles.kicker\}>내 지갑 · \{walletCards.length\}장<\/Text><Text style=\{styles.lead\}>오늘 사용할 카드<\/Text><\/View>/,
  '<View style={{flex:1}}><Text style={styles.kicker}>내 지갑 · {walletCards.length}장</Text><Text style={styles.lead}>지금 사용할 <Text style={{color:"#1756D8"}}>카드</Text></Text></View>');
main = change(main,/\{wallet\(\)\}/,'<View style={{backgroundColor:"#EAF1FF",borderRadius:24,paddingVertical:12}}>{wallet()}</View>');
main = change(main,/\{walletBenefitSummary\(\)\}/,`<TouchableOpacity style={styles.scheduleLink} onPress={() => selectTab('schedule')}>
        <Ionicons name="calendar-outline" size={22} color="#1954C8"/>
        <Text style={{flex:1,fontWeight:'700',fontSize:16}}>오늘의 일정</Text>
        <Ionicons name="chevron-forward" size={19} color="#426185"/>
      </TouchableOpacity>
      {walletBenefitSummary()}`);
main = change(main,/<View style=\{styles.walletHintRow\}>[\s\S]*?<\/View>/,'');
main = main.replaceAll('maxWidth: 760','maxWidth: 640')
  .replace('const styles = StyleSheet.create({', `const styles = StyleSheet.create({
  scheduleLink:{flexDirection:'row',alignItems:'center',gap:12,minHeight:54,borderBottomWidth:1,borderBottomColor:'#DFE7F0'},`);
panel = change(panel,/disabled = false/, 'showPage = true, disabled = false');
panel = change(panel,/AppState, Platform,/, 'AppState, ScrollView, Platform,');
panel = change(panel,/return <View style=\{styles.panel\}>/, 'return <>{showPage && <ScrollView style={{flex:1}} contentContainerStyle={styles.panel}>');
panel = change(panel,/<Text style=\{styles.title\}>🗓️ \{day\} 오늘의 일정<\/Text>/,
  '<Text style={{color:"#315C9B",fontWeight:"700"}}>{day}</Text><Text style={[styles.title,{fontSize:30,lineHeight:40}]}>오늘의 일정</Text>');
panel = change(panel,/<SpecialScheduleModal key=/,'</ScrollView>}<SpecialScheduleModal key=');
panel = change(panel,/    <\/View>;/,'    </>;');
panel = panel.replace('maxWidth: 1040','maxWidth: 640');
card = change(card,/<Text style=\{s.hint\}>눌러서 이 카드로 결제하기<\/Text>/,'');
card = change(card,/maxWidth: 440,[\s\S]*?gap: 10/, `maxWidth: 440, alignSelf:'center', backgroundColor:'#FFFFFF',
    borderRadius:18, padding:12, width:'94%', gap:4`.replace(", width:'94%'",''));

wheel = change(wheel,/\{Platform\.OS === 'web' && cards.length > 1 && <Text style=\{s.hint\}>[^<]+<\/Text>\}/,'');
const updated = [app,main,panel,card,wheel];
updated.forEach(s => babel.parseSync(s,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}}));
files.forEach((f,i) => {
  if (!fs.existsSync(f+'.before-schedule-nav.bak')) fs.copyFileSync(f,f+'.before-schedule-nav.bak');
  fs.writeFileSync(f,updated[i]);
});
console.log('홈 디자인 및 오늘의 일정 탭 적용 완료');

