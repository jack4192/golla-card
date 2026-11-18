const fs=require('node:fs');
const path=require('node:path');
const babel=require('@babel/core');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'screens/MainScreen.js');
const source=fs.readFileSync(target,'utf8');
const parse=code=>babel.parseSync(code,{configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
const ast=parse(source);
let matches=0;
function visit(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='VariableDeclarator'&&node.id?.name==='wallet'&&node.init?.type==='ArrowFunctionExpression'){
    matches++;
    const body=node.init.body;
    if(body.type==='JSXElement'&&body.openingElement.name.name==='WalletWheelControls')return;
    if(!['JSXFragment','JSXElement'].includes(body.type))throw Error('지갑 화면 형식을 확인해주세요. 기존 파일 변경 없음.');
    const wrapper=parse('const item=<WalletWheelControls cards={walletCards} selectedId={currentCard.id} onSelect={onSelectCard}></WalletWheelControls>;').program.body[0].declarations[0].init;
    wrapper.children=[body];node.init.body=wrapper;return;
  }
  for(const value of Object.values(node)){
    if(Array.isArray(value))value.forEach(visit);
    else if(value&&typeof value==='object')visit(value);
  }
}
visit(ast);
if(matches!==1)throw Error('내 지갑 연결 위치를 정확히 찾지 못했습니다. 기존 파일 변경 없음.');
if(!ast.program.body.some(node=>node.type==='ImportDeclaration'&&node.source.value==='../components/WalletWheelControls'))ast.program.body.unshift(parse("import WalletWheelControls from '../components/WalletWheelControls';").program.body[0]);
const main=babel.transformFromAstSync(ast,source,{configFile:false,babelrc:false,comments:true}).code+'\n';
const component=String.raw`import React, {useEffect, useRef} from 'react';
import {Platform, StyleSheet, Text, TouchableOpacity, View} from 'react-native';

export function createWalletWheelHandler(getState, select, clock = Date.now) {
  let amount = 0, lastMove = -Infinity, lastEvent = -Infinity;
  return event => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented || event.cancelable === false) return false;
    const {cards, index} = getState();
    if (cards.length < 2) return false;
    const x = Number(event.deltaX) || 0, y = Number(event.deltaY) || 0;
    const raw = Math.abs(x) > Math.abs(y) ? x : y;
    if (!raw || !Number.isFinite(raw)) return false;
    const direction = Math.sign(raw), next = index + direction;
    if (next < 0 || next >= cards.length) {amount = 0; return false;}
    const now = clock();
    const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
    if (now - lastEvent > 180 || Math.sign(amount) !== direction) amount = 0;
    lastEvent = now;
    event.preventDefault();
    if (now - lastMove < 240) {amount = 0; return true;}
    amount += delta;
    if (Math.abs(amount) >= 35) {
      amount = 0; lastMove = now; select(next);
    }
    return true;
  };
}

export default function WalletWheelControls({cards = [], selectedId, onSelect, children}) {
  const root = useRef(null), latest = useRef(null), position = useRef(0);
  const index = Math.max(0, cards.findIndex(card => card.id === selectedId));
  latest.current = {cards, onSelect};
  position.current = index;
  const go = next => {
    const value = latest.current;
    if (next < 0 || next >= value.cards.length || next === position.current) return;
    position.current = next;
    value.onSelect?.(value.cards[next].id);
  };
  const move = useRef(go);
  move.current = go;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = root.current;
    if (!node?.addEventListener) return;
    const wheel = createWalletWheelHandler(
      () => ({cards:latest.current.cards, index:position.current}),
      next => move.current(next)
    );
    const options = {passive:false, capture:true};
    node.addEventListener('wheel', wheel, options);
    return () => node.removeEventListener('wheel', wheel, options);
  }, []);

  return <View ref={root} style={s.root}>
    {children}
    <View style={s.controls}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="이전 지갑 카드"
        disabled={!cards.length || index === 0} onPress={() => move.current(position.current - 1)}
        style={[s.button, (!cards.length || index === 0) && s.disabled]}>
        <Text style={s.blue}>‹ 이전 카드</Text>
      </TouchableOpacity>
      <Text style={s.count} accessibilityLiveRegion="polite">{cards.length ? index + 1 : 0} / {cards.length}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="다음 지갑 카드"
        disabled={!cards.length || index === cards.length - 1} onPress={() => move.current(position.current + 1)}
        style={[s.button, (!cards.length || index === cards.length - 1) && s.disabled]}>
        <Text style={s.blue}>다음 카드 ›</Text>
      </TouchableOpacity>
    </View>
    {Platform.OS === 'web' && cards.length > 1 && <Text style={s.hint}>카드 위에서 휠을 내리면 다음 카드, 올리면 이전 카드로 이동해요.</Text>}
  </View>;
}

const s = StyleSheet.create({
  root:{width:'100%'},controls:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:16,marginTop:14},
  button:{minHeight:44,paddingVertical:12,paddingHorizontal:16,borderRadius:12,backgroundColor:'#EAF1FF',alignItems:'center',justifyContent:'center'},
  blue:{fontSize:12,fontWeight:'700',color:'#245DE5'},count:{fontSize:12,fontWeight:'700',color:'#6D83A7',minWidth:50,textAlign:'center'},
  hint:{fontSize:11,lineHeight:19,color:'#8698B5',textAlign:'center',marginTop:8},disabled:{opacity:0.35},
});
`;
parse(main);parse(component);
for(const [name,content] of [['screens/MainScreen.js',main],['components/WalletWheelControls.js',component]]){
  const file=path.join(root,name),backup=file+'.before-wallet-wheel.bak';
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)&&!fs.existsSync(backup))fs.copyFileSync(file,backup);
  fs.writeFileSync(file,content,'utf8');
}
console.log('완료: 내 지갑 마우스 휠 + 이전·다음 버튼. App.js 변경 없음. 기존 파일 백업 완료.');
