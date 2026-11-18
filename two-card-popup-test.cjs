const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let raw=null,failRead=false,failWrite=false;
const localStorage={getItem:()=>{if(failRead)throw Error('read failed');return raw;},setItem:(k,v)=>{if(failWrite)throw Error('write failed');raw=v;}};
const listeners=new Set();
const native={Platform:{OS:'web'},StyleSheet:{create:x=>x,absoluteFillObject:{}},AppState:{currentState:'active',addEventListener:(event,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)}}},Linking:{openURL:async()=>{}}};
for(const name of ['ActivityIndicator','Modal','Text','TouchableOpacity','View','Image','ScrollView'])native[name]=name;
const modules={};let currentHarness;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:init=>currentHarness.useState(init),useRef:init=>currentHarness.useRef(init),useMemo:fn=>fn(),useEffect:(fn,deps)=>currentHarness.useEffect(fn,deps)};
function load(name){if(modules[name])return modules[name];
 const context={exports:{},window:{localStorage},console,require:source=>{
 if(source==='react')return{...React,default:React,__esModule:true};if(source==='react-native')return native;
 if(source.endsWith('demoStore'))return{};
 if(source.endsWith('myDataService'))return{restoreMyData:async()=>null,subscribeMyData:()=>()=>{}};
 if(source.endsWith('RoutineRecommendationScreen')&&name.includes('LaunchPopup'))return{__esModule:true,default:function Recommendations(){}};
 const map={cardCatalogCsv:'data/cardCatalogCsv.js',cardRecommendationProducts:'data/cardRecommendationProducts.js',routineData:'utils/routineData.js',routineDetails:'utils/routineDetails.js',cardRecommendation:'utils/cardRecommendation.js',RoutinePatternRecommendationScreen:'screens/RoutinePatternRecommendationScreen.js',recommendationPopup:'utils/recommendationPopup.js'};
 const key=Object.keys(map).find(key=>source.endsWith(key));if(key)return load(map[key]);throw Error('Unexpected import '+source);
 }};
 vm.runInNewContext(babel.transformSync(fs.readFileSync(name,'utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);return modules[name]=context.exports;
}
function harness(Component,props){const h={states:[],refs:[],effects:[],pending:[],props};h.useState=init=>{const i=h.si++;if(!(i in h.states))h.states[i]=typeof init==='function'?init():init;return[h.states[i],next=>h.states[i]=typeof next==='function'?next(h.states[i]):next];};h.useRef=init=>{const i=h.ri++;return h.refs[i]||(h.refs[i]={current:init});};h.useEffect=(fn,deps)=>{const i=h.ei++,old=h.effects[i];if(!old||deps.some((v,j)=>!Object.is(v,old.deps[j]))){h.pending.push(()=>{old?.cleanup?.();h.effects[i]={deps,cleanup:fn()};});}};h.render=()=>{h.si=0;h.ri=0;h.ei=0;currentHarness=h;h.tree=Component(h.props);return h.tree;};h.step=async()=>{h.render();h.pending.splice(0).forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));return h.render();};h.unmount=()=>h.effects.forEach(effect=>effect.cleanup?.());return h;}
function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[];}
function click(h,label){const n=nodes(h.render()).find(n=>n.type==='TouchableOpacity'&&(n.props.accessibilityLabel===label||nodes(n).some(t=>t.type==='Text'&&t.props.children.includes(label))));assert(n,label);assert(!n.props.disabled);return n.props.onPress();}
(async()=>{
 const store=load('utils/recommendationPopup.js');assert.equal(await store.readHiddenUntil(),0);
 const until=await store.hideForSevenDays(1000);assert.equal(until,1000+604800000);assert.equal(await store.readHiddenUntil(),until);assert(!store.canShowPopup(until,until-1));assert(store.canShowPopup(until,until));assert.throws(()=>store.parseHiddenUntil('"bad"'));
 failWrite=true;const previous=raw;await assert.rejects(store.hideForSevenDays());assert.equal(raw,previous);failWrite=false;raw=null;
 const Popup=load('components/RecommendationLaunchPopup.js').default;
 const h=harness(Popup,{enabled:false});await h.step();assert(!h.tree.props.visible);h.props.enabled=true;await h.step();assert(h.tree.props.visible);
 failWrite=true;await click(h,'7일간 보지 않기');assert(h.render().props.visible);assert(h.states[4].includes('저장하지 못했어요'));failWrite=false;
 await click(h,'7일간 보지 않기');assert(!h.render().props.visible);assert(JSON.parse(raw)>Date.now());
 listeners.forEach(fn=>fn('background'));await h.step();listeners.forEach(fn=>fn('active'));await h.step();assert(!h.tree.props.visible);
 raw='0';listeners.forEach(fn=>fn('background'));await h.step();listeners.forEach(fn=>fn('active'));await h.step();assert(h.tree.props.visible);click(h,'닫기');await h.step();assert(!h.tree.props.visible);
 h.props.enabled=false;await h.step();h.props.enabled=true;await h.step();assert(!h.tree.props.visible);
 h.unmount();const again=harness(Popup,{enabled:true});await again.step();assert(!again.tree.props.visible);again.unmount();
 store.nextLaunch();failRead=true;const unreadable=harness(Popup,{enabled:true});await unreadable.step();assert(!unreadable.tree.props.visible);failRead=false;unreadable.unmount();
 const screen=load('screens/RoutineRecommendationScreen.js');const profile={coffee:'always',lunchPlace:'convenience',transport:'public'};
 const result=screen.buildTwoRecommendations(profile,[],{owned:[]},null,new Date('2026-11-17T12:00:00'));
 assert.equal(result.length,2);assert(result[0]&&result[1]);assert.equal(result[0].label,'카드사 추천');assert.equal(result[1].label,'가맹점 추천');assert(result[1].matches.every(row=>row.benefit.brandScope==='BRAND_ONLY'));assert(result.every(row=>screen.officialProduct(row.card.code)));
 const ui=harness(screen.default,{onNext:()=>{},onBack:()=>{}});ui.render();ui.pending=[];ui.states[0]={profile,events:[],saved:{owned:[]}};ui.states[3]=false;
 const tree=ui.render();const numbered=nodes(tree).filter(n=>n.type==='TouchableOpacity'&&/^\d\. /.test(n.props.accessibilityLabel||''));assert.deepEqual(numbered.map(n=>n.props.accessibilityLabel),['1. 카드사 추천','2. 가맹점 추천']);assert(!nodes(tree).some(n=>n.type==='Text'&&n.props.children.includes('7일간 보지 않기')));
 click(ui,'2. 가맹점 추천');assert.equal(ui.states[2],1);ui.props.presentation='popup';assert(!nodes(ui.render()).some(n=>n.type==='Text'&&n.props.children.includes('괜찮아요, 메인으로 갈게요')));
 const main=fs.readFileSync('screens/MainScreen.js','utf8');assert.equal((main.match(/<RecommendationLaunchPopup\b/g)||[]).length,1);assert(fs.readFileSync('utils/privacyData.js','utf8').includes(store.POPUP_KEY));
 console.log('PASS: 2 real-card slots; merchant brand-only match; screen hides ad controls; persistent 7-day timestamp and exact expiry; failed saves retain popup; failed reads respect hidden settings; foreground display; close/remount/navigation does not repeat; one Main integration and cleanup key');
 console.log('Actual products:',result.map(row=>row.card.code).join(', '));
})().catch(error=>{console.error(error);process.exitCode=1;});
