const fs=require('node:fs');
const path=require('node:path');
const babel=require('@babel/core');
const root=path.resolve(__dirname,'..');
const target=path.join(root,'screens/MainScreen.js');
const source=fs.readFileSync(target,'utf8');
const parse=code=>babel.parseSync(code,{configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
const ast=parse(source);
let wallets=0, lists=0, changed=0;
const attr=(node,name)=>node.openingElement.attributes.find(item=>item.type==='JSXAttribute'&&item.name.name===name);
function update(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='JSXElement'&&node.openingElement.name.name==='FlatList'&&attr(node,'data')?.value?.expression?.name==='walletCards'){
    lists++;
    const render=attr(node,'renderItem')?.value?.expression;
    if(render?.type!=='ArrowFunctionExpression'||render.body.type!=='JSXElement')throw Error('카드 렌더링 형식 확인 실패. 파일 변경 없음.');
    const elements=render.body.children.filter(item=>item.type==='JSXElement');
    if(elements.length!==1)throw Error('카드 표시 위치 확인 실패. 파일 변경 없음.');
    const old=elements[0];
    if(old.openingElement.name.name==='WalletProductCard')return;
    if(old.openingElement.name.name!=='TouchableOpacity')throw Error('기존 카드 버튼 확인 실패. 파일 변경 없음.');
    const press=attr(old,'onPress')?.value?.expression;
    if(!press)throw Error('카드 결제 연결 확인 실패. 파일 변경 없음.');
    const replacement=parse('const item=<WalletProductCard card={item} onPress={()=>{}}/>;').program.body[0].declarations[0].init;
    attr(replacement,'onPress').value.expression=press;
    render.body.children=render.body.children.map(item=>item===old?replacement:item);
    changed++;return;
  }
  for(const value of Object.values(node)){
    if(Array.isArray(value))value.forEach(update);
    else if(value&&typeof value==='object')update(value);
  }
}
function locate(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='VariableDeclarator'&&node.id?.name==='wallet'){wallets++;update(node.init);return;}
  for(const value of Object.values(node)){
    if(Array.isArray(value))value.forEach(locate);
    else if(value&&typeof value==='object')locate(value);
  }
}
locate(ast);
if(wallets!==1||lists!==1||changed>1)throw Error('내 지갑 위치를 정확히 찾지 못했습니다. 파일 변경 없음.');
if(!ast.program.body.some(node=>node.type==='ImportDeclaration'&&node.source.value==='../components/WalletProductCard'))ast.program.body.unshift(parse("import WalletProductCard from '../components/WalletProductCard';").program.body[0]);
const main=babel.transformFromAstSync(ast,source,{configFile:false,babelrc:false,comments:true}).code+'\n';
const component=String.raw`import React, {useState} from 'react';
import {ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {CARD_CATALOG} from '../data/cards';
import {CSV_CARD_CATALOG} from '../data/cardCatalogCsv';
import {CARD_PRODUCTS} from '../data/cardRecommendationProducts';

export function resolveWalletProduct(card) {
  if (!card) return null;
  const code = card.catalogCode || card.code ||
    (card.id === 'solmate' ? 'SH_SOLMATE_SOL_PLAN_CHECK' : card.id);
  const catalog = CSV_CARD_CATALOG.find(item => item.code === code) ||
    CSV_CARD_CATALOG.find(item => item.name === card.name && (!card.type || item.type === card.type));
  if (catalog) {
    const image = CARD_PRODUCTS[catalog.code]?.image;
    return image ? {key:catalog.code, name:catalog.name, issuer:catalog.issuer, image} : null;
  }
  const pdf = CARD_CATALOG[card.id];
  return pdf?.image ? {key:card.id, name:pdf.name, issuer:'신한카드', image:pdf.image} : null;
}

export function WalletProductCardBody({card, product, onPress}) {
  const [loading, setLoading] = useState(!!product);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const name = product?.name || card.name;
  return <View style={s.card}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={name + ' 카드로 결제 화면 열기'}
      activeOpacity={0.88} onPress={onPress} style={s.pressable}>
      <View style={s.artwork}>
        {product && !failed ? <Image key={attempt} source={product.image} resizeMode="contain"
          style={s.image} accessibilityLabel={name + ' 실제 상품 이미지'}
          onLoad={() => setLoading(false)}
          onError={() => {setLoading(false); setFailed(true);}}/> :
          <View style={s.missing}><Text style={s.missingTitle}>{failed ? '이미지를 불러오지 못했어요' : '상품 이미지 확인이 필요해요'}</Text>
            <Text style={s.hint}>{failed ? '인터넷 연결을 확인한 뒤 다시 불러와주세요.' : '정확한 상품 이미지가 등록되지 않은 카드예요.'}</Text></View>}
        {loading && !failed && <View pointerEvents="none" style={s.loading}><ActivityIndicator color="#245DE5"/></View>}
      </View>
      <Text style={s.issuer}>{product?.issuer || card.issuer}</Text>
      <Text style={s.name}>{name}</Text>
      <Text style={s.hint}>눌러서 이 카드로 결제하기</Text>
    </TouchableOpacity>
    {failed && <TouchableOpacity accessibilityRole="button" accessibilityLabel="지갑 카드 이미지 다시 불러오기"
      onPress={() => {setLoading(true); setFailed(false); setAttempt(value => value + 1);}} style={s.retry}>
      <Text style={s.link}>이미지 다시 불러오기</Text>
    </TouchableOpacity>}
  </View>;
}

export default function WalletProductCard({card, onPress}) {
  const product = resolveWalletProduct(card);
  const identity = String(card.id) + ':' + (product?.key || 'missing') + ':' + (product?.image?.uri || 'local');
  return <WalletProductCardBody key={identity} card={card} product={product} onPress={onPress}/>;
}

const s = StyleSheet.create({
  card:{width:'100%',maxWidth:440,alignSelf:'center',backgroundColor:'#FFF',borderRadius:22,padding:16,borderWidth:1,borderColor:'#E5ECF8',gap:10},
  pressable:{alignItems:'center',gap:8},artwork:{width:'100%',maxWidth:360,aspectRatio:1.35,alignItems:'center',justifyContent:'center'},
  image:{width:'100%',height:'100%'},loading:{...StyleSheet.absoluteFillObject,alignItems:'center',justifyContent:'center'},
  issuer:{fontSize:12,fontWeight:'700',color:'#7C8EA8',textAlign:'center'},name:{fontSize:18,lineHeight:27,fontWeight:'800',color:'#203D66',textAlign:'center'},
  hint:{fontSize:12,lineHeight:20,color:'#8798B1',textAlign:'center'},missing:{alignItems:'center',gap:10,padding:18},missingTitle:{fontSize:15,lineHeight:23,fontWeight:'700',color:'#627A9C',textAlign:'center'},
  retry:{alignSelf:'center',padding:12,borderRadius:10,backgroundColor:'#EDF3FF',minHeight:44,justifyContent:'center'},link:{fontSize:12,fontWeight:'700',color:'#245DE5'},
});
`;
parse(main);parse(component);
for(const [name,content] of [['screens/MainScreen.js',main],['components/WalletProductCard.js',component]]){
  const file=path.join(root,name),backup=file+'.before-real-wallet-image.bak';
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(fs.existsSync(file)&&!fs.existsSync(backup))fs.copyFileSync(file,backup);
  fs.writeFileSync(file,content,'utf8');
}
console.log('완료: 내 지갑 실제 카드 이미지 적용. 기존 파일 백업 완료. App.js 변경 없음.');
