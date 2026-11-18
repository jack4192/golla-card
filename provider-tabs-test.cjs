const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],si=0,opened='',next=0,fail=false;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:init=>{const i=si++;if(!(i in states))states[i]=init;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next];}};
const Native={StyleSheet:{create:x=>x},Linking:{openURL:async url=>{if(fail)throw Error('link failed');opened=url;}}};
for(const name of ['Image','ScrollView','Text','TouchableOpacity','View'])Native[name]=name;
const product={SH_MODU:{image:{uri:'https://example.test/card.png'}}},catalog=[{code:'SH_MODU',name:'real product'}],pattern=function Pattern(){};
const context={exports:{},URL,require:name=>name==='react'?{...React,default:React,__esModule:true}:name==='react-native'?Native:name.includes('cardCatalogCsv')?{CSV_CARD_CATALOG:catalog}:name.includes('cardRecommendationProducts')?{CARD_PRODUCTS:product}:name.includes('providerRecommendations')?{PROVIDER_RECOMMENDATIONS:{issuer:[],merchant:[]}}:{__esModule:true,default:pattern}};
vm.runInNewContext(babel.transformSync(fs.readFileSync('screens/RoutineRecommendationScreen.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);
const api=context.exports;
const item={id:'1',providerName:'test source',title:'test title',description:'supplied text',sourceUrl:'https://example.test/offer',cardCode:'SH_MODU'};
function render(feed){si=0;return api.default({onNext:()=>next++,onBack:()=>{},providerRecommendations:feed});}
function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[];}
function button(label,feed){const match=nodes(render(feed)).find(n=>n.type==='TouchableOpacity'&&nodes(n).some(t=>t.type==='Text'&&t.props.children.includes(label)));assert(match,label);return match.props.onPress();}
(async()=>{
assert.deepEqual(Array.from(api.RECOMMENDATION_TABS.map(row=>row.label)),['1. 카드사 추천','2. 가맹점 추천']);
assert.equal(api.providerItems({issuer:[item]},'issuer').rows.length,1);
for(const bad of [{...item,sourceUrl:'javascript:alert(1)'},{...item,sourceUrl:'https://user:pass@example.test'},{...item,cardCode:'invented'},{...item,providerName:''}])assert.equal(api.providerItems({issuer:[bad]},'issuer').rows.length,0);
assert(api.providerItems({issuer:[item,item]},'issuer').invalid);
assert.equal(api.providerItems({merchant:[{...item,cardCode:undefined,merchantName:'test shop'}]},'merchant').rows.length,1);
assert.equal(api.providerItems({merchant:[item]},'merchant').rows.length,0);
let tree=render();assert.equal(nodes(tree).filter(n=>n.props.accessibilityRole==='tab').length,2);assert(nodes(tree).some(n=>n.type==='Text'&&n.props.children.includes('아직 도착한 추천이 없어요')));assert(!nodes(tree).some(n=>n.type===pattern));
button('생활 패턴으로 추천받기');assert(nodes(render()).some(n=>n.type===pattern));button('2. 가맹점 추천');assert(!nodes(render()).some(n=>n.type===pattern));assert.equal(states[0],'merchant');
button('1. 카드사 추천');const feed={issuer:[item],merchant:[]};await button('제공처 안내·조건 보기',feed);assert.equal(opened,item.sourceUrl);fail=true;await button('제공처 안내·조건 보기',feed);assert.equal(states[2],'link failed');
await button('메인으로');assert.equal(next,1);
console.log('PASS: exactly two provider tabs; no fabricated empty-feed results; separate opt-in lifestyle recommendation; provider-specific data isolation; real card lookup; invalid URL/card/source rejected; link error and main navigation');
})().catch(error=>{console.error(error);process.exitCode=1;});
