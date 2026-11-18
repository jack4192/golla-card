const fs = require('fs');
let source = fs.readFileSync('App.js', 'utf8');
source = source.replace("const NOOP = () => {};\nconst ASYNC_NOOP = async () => {};", '');
source = source.replace('  const renderScreen = (screen, preview = false) => {', `
  const previewGo = screen => { Keyboard.dismiss(); setPreviewScreen(screen); setShowDevMenu(false); };
  const previewSelect = id => {
    if (!walletCards.some(card => card.id === id)) return;
    selectedCardRef.current = id;
    setActiveCardId(id);
  };
  const previewPreferences = async preferences => {
    const cards = buildWallet(preferences);
    const id = validWalletId(cards, selectedCardRef.current);
    setWalletCards(cards); selectedCardRef.current = id; setActiveCardId(id);
  };
  const previewUseCard = async code => {
    const snapshot = await readWallet();
    const id = walletIdForCode(code);
    if (!snapshot.cards.some(card => card.id === id)) throw Error('보유 카드로 등록하고 저장해주세요.');
    setWalletCards(snapshot.cards); selectedCardRef.current = id; setActiveCardId(id);
    previewGo('Payment');
  };
  const renderScreen = (screen, preview = false) => {
    if (preview) {
      switch (screen) {
        case 'Login': return <LoginScreen onLogin={async () => previewGo('Agreement')} onSignUp={() => previewGo('SignUp')} demoAccountReady />;
        case 'PinLogin': return <PinLoginScreen onVerify={async pin => { if (!/^\\d{6}$/.test(pin)) throw Error('6자리 숫자를 입력해주세요.'); previewGo('Main'); }} onUsePassword={() => previewGo('Login')} />;
        case 'SignUp': return <SignUpScreen onBack={() => previewGo('Login')} onComplete={() => previewGo('Login')} isIdTaken={id => id === 'demo'} />;
        case 'Agreement': return <AgreementScreen initialDraft={consentDraft} onDraftChange={setConsentDraft} onBack={() => previewGo('Login')} onNext={async () => previewGo('PinSetup')} />;
        case 'PinSetup': return <PinSetupScreen configured={false} readOnly={false} onBack={() => previewGo('Agreement')} onContinue={() => previewGo('DailyRoutine')} onNext={async () => previewGo('DailyRoutine')} />;
        case 'DailyRoutine': return <DailyRoutineScreen initialDraft={routineDraft} onDraftChange={setRoutineDraft} readOnly={false} onBack={() => previewGo('Main')} onContinue={() => previewGo('RoutineRecommendation')} />;
        case 'RoutineRecommendation': return <RoutineRecommendationScreen onBack={() => previewGo('DailyRoutine')} onNext={async () => previewGo('Main')} onPreferencesChange={previewPreferences} onUseCard={previewUseCard} />;
        case 'MyDataLoading': return <MyDataLoadingScreen onNext={() => previewGo('MyDataResult')} />;
        case 'MyDataResult': return <MyDataScreen onNext={() => previewGo('RoutineRecommendation')} />;
        case 'Payment': return <PaymentScreen card={activeCard} cards={walletCards} onSelectCard={previewSelect} onClose={() => previewGo('Main')} navigation={{ navigate: target => previewGo(target === 'MainScreen' ? 'Main' : target) }} />;
        case 'Main': return <View style={styles.screen}><TodaySchedulePanel disabled={false} onEditRoutine={() => previewGo('DailyRoutine')} onViewBenefits={() => previewGo('RoutineRecommendation')} /><MainScreen walletCards={walletCards} activeCardId={activeCardId} onSelectCard={previewSelect} onLogout={() => previewGo('Login')} onOpenChat={() => Alert.alert('안내', '챗봇 화면은 아직 연결되지 않았습니다.')} /><TouchableOpacity style={styles.pinLoginBack} onPress={() => previewGo('Payment')}><Text style={styles.previewCloseText}>선택한 카드로 결제 화면 열기</Text></TouchableOpacity></View>;
        default: return <LoginScreen onLogin={async () => previewGo('Agreement')} onSignUp={() => previewGo('SignUp')} />;
      }
    }
`);
// The normal flow now only handles preview=false. Remove unused dead branches.
const start = source.indexOf("    switch (screen) {", source.indexOf("    if (preview) {"));
const normalStart = source.indexOf("    switch (screen) {", start + 10);
const normalEnd = source.indexOf('\n  if (isRestoring)', normalStart);
let normal = source.slice(normalStart, normalEnd);
normal = normal.replace(/preview \? ASYNC_NOOP : /g, '').replace(/preview \? NOOP : /g, '').replace('configured={preview ? false : hasSavedPin}', 'configured={hasSavedPin}').replace('readOnly={preview}', 'readOnly={false}').replace('initialDraft={preview ? null : routineDraft}', 'initialDraft={routineDraft}').replace('disabled={preview || Boolean(previewScreen) || privacyOpen}', 'disabled={Boolean(previewScreen) || privacyOpen}');
source = source.slice(0, normalStart) + normal + source.slice(normalEnd);
source = source.replace('개발자 미리보기 · 읽기 전용', '개발자 체험 · 버튼 조작 가능');
source = source.replace('인증·가입 진행 상태를 바꾸지 않습니다.', '미리보기 로그인은 화면 이동용입니다. 일과·카드·설정 저장은 데모 데이터에 반영됩니다.');
source = source.replace(/\n            pointerEvents="none"\n            accessibilityElementsHidden\n            importantForAccessibility="no-hide-descendants"\n            onKeyDownCapture=\{event => \{\n              event.preventDefault\(\);\n              event.stopPropagation\(\);\n            \}\}/, '');
fs.writeFileSync('App.js', source);
const babel = require('@babel/core');
const generator = require('@babel/generator').default;
const ast = babel.parseSync(source, {configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
// Compact each top-level function statement while keeping JSX screen definitions readable in the delivered file.
const app = ast.program.body.find(n => n.type==='ExportDefaultDeclaration');
const output = [];
for(const node of ast.program.body) {
 if(node===app) {
   output.push('export default function App() {');
   for(const statement of node.declaration.body.body) output.push('  '+generator(statement,{comments:false,concise:true}).code);
   output.push('}');
 } else output.push(generator(node,{comments:false,concise:true}).code);
}
fs.writeFileSync('App.full.js.txt',output.join('\n\n')+'\n');
console.log('Patched, parsed; full file chars:',output.join('\n').length);
