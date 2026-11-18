const fs=require('fs'),vm=require('vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],refs=[],sc=0,rc=0,lastPreferences,opened,nextArgs;
const React={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:init=>{const i=sc++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef:init=>{const i=rc++;return refs[i]||(refs[i]={current:init})},useEffect(){},useMemo:fn=>fn()};
const native={Platform:{OS:'web'},StyleSheet:{create:x=>x,absoluteFillObject:{}},Linking:{openURL:async url=>{opened=url}}};for(const n of ['View','Text','ScrollView','TouchableOpacity','ActivityIndicator'])native[n]=n;
const products={module:{exports:{}}};vm.runInNewContext(fs.readFileSync('data/cardRecommendationProducts.js','utf8').replace('export const CARD_PRODUCTS =','module.exports ='),products);
const benefit={name:'카페 혜택',rate:.1,minPrevSpend:400000,type:'DISCOUNT'};
const sample=(code,owned)=>({card:{code,name:code,issuer:'신한카드',annualFee:10000},owned,matches:[{category:'cafe',weight:1,reasons:['평소 커피를 거의 매일 마심'],benefit}]});
const utils={emptyPreferences:()=>({owned:[],spend:{},remaining:{},scenario:{spend:'',amount:'',assume:false}}),rankRecommendations:(p,e,pref)=>{lastPreferences=pref;return[sample('SH_MODU',pref.owned.includes('SH_MODU')),sample('SH_DISCOUNT_PLAN_PLUS',false)]},benefitText:()=> '10%',money:n=>n+'원'};
const ctx={exports:{},require:n=>n==='react'?{...React,default:React,__esModule:true}:n==='react-native'?native:n.endsWith('cardRecommendationProducts')?{CARD_PRODUCTS:products.module.exports}:n.endsWith('cardRecommendation')?utils:{},console};
vm.runInNewContext(babel.transformSync(fs.readFileSync('screens/RoutinePatternRecommendationScreen.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,ctx);
const api=ctx.exports;
function render(){sc=0;rc=0;return api.default({onNext:async(...args)=>{nextArgs=args},onBack:()=>{}})}
function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[]}
function button(label){return nodes(render()).find(n=>n.type==='TouchableOpacity'&&nodes(n).some(t=>t.type==='Text'&&t.props.children.includes(label)))}
(async()=>{
 const data={endExclusive:'2026-11-01',transactions:[{date:'2026-10-03 12:00:00',category:'카페',amount:1},{date:'2026-10-04 12:00:00',category:'카페',amount:100},{date:'2026-10-31 22:00:00',category:'커피',amount:200},{date:'2026-11-01 00:00:00',category:'카페',amount:500}]};
 const result=api.recentPattern(data,'cafe');assert.equal(result.count,2);assert.equal(result.amount,300);assert.equal(result.start,'2026-10-04');assert.equal(result.last,'2026-10-31');assert.equal(api.recentPattern(null,'cafe'),null);assert(api.officialProduct('SH_DISCOUNT_PLAN_PLUS'));assert.equal(api.officialProduct('not-a-real-card'),null);
 render();states[0]={profile:{},events:[],saved:{owned:['SH_MODU'],scenario:{spend:'999999',amount:'500000',assume:true}}};states[2]=false;
 const tree=render();assert(!lastPreferences.scenario.assume);assert.equal(lastPreferences.scenario.spend,'');assert.equal(lastPreferences.scenario.amount,'');
 assert(nodes(tree).some(n=>typeof n.type==='function'&&n.props.card?.code==='SH_DISCOUNT_PLAN_PLUS'));
 await button('카드 신청').props.onPress();assert.equal(opened,products.module.exports.SH_DISCOUNT_PLAN_PLUS.url);
 await button('괜찮아요, 메인으로 갈게요').props.onPress();assert.deepEqual(nextArgs,[]);
 native.Linking.openURL=async()=>{throw Error('official page unavailable')};await button('카드 신청').props.onPress();assert(states[3].includes('official page unavailable'));
 console.log('PASS 28-day boundaries/counts; official-image registry; no invented product; ignore old manual assumptions; prefer unowned; official link CTA; skip without card registration; link failure visible');
})().catch(e=>{console.error(e);process.exitCode=1});
