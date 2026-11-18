const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
let states=[],refs=[],sc=0,rc=0,saveImpl,notifyImpl;
const prefs=()=>({month:'2026-11',owned:['T'],interests:[],spend:{},remaining:{},scenario:{spend:'',amount:'',assume:false}});
const React={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:init=>{const i=sc++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef:init=>{const i=rc++;return refs[i]||(refs[i]={current:init})},useEffect(){},useMemo:fn=>fn()};
const native={Platform:{OS:'web'},StyleSheet:{create:x=>x,absoluteFillObject:{}}};for(const n of ['ActivityIndicator','ScrollView','Text','TouchableOpacity','View','TextInput','Modal','KeyboardAvoidingView','Image'])native[n]=n;
const utils={emptyPreferences:prefs,rankRecommendations:()=>[],savePreferences:p=>saveImpl(p),normalizePreferences:p=>p,money:v=>v+'원'};
const ctx={exports:{},require:n=>n==='react'?{...React,default:React,__esModule:true}:n==='react-native'?native:n.endsWith('/cardRecommendation')?utils:n.endsWith('/routineData')?{dateKey:()=> '2026-11-17'}:n.endsWith('/cardCatalogCsv')?{CSV_CARD_CATALOG:[{code:'T',name:'테스트 카드',issuer:'테스트',type:'신용',tags:[],benefits:[]}]}:{CARD_PRODUCTS:{}},console};
vm.runInNewContext(babel.transformSync(fs.readFileSync('screens/RoutineRecommendationScreen.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,ctx);
function render(){sc=0;rc=0;return ctx.exports.default({onPreferencesChange:p=>notifyImpl(p)});}
function nodes(n,anc=[]){return n&&typeof n==='object'?[{n,anc},...(n.props?.children||[]).flatMap(x=>nodes(x,[...anc,n]))]:[];}
function saveButton(){return nodes(render()).find(({n})=>n.type==='TouchableOpacity'&&nodes(n).some(({n:t})=>t.type==='Text'&&t.props.children.includes('저장 및 나가기')));}
function fresh(){states=[];refs=[];render();states[3]=false;states[11]=true;states[7]=true;}
(async()=>{
 fresh();let release;saveImpl=p=>new Promise(resolve=>{release=()=>resolve(p)});notifyImpl=async()=>{};
 const {n,anc}=saveButton();assert(!anc.some(p=>p.type==='ScrollView'),'save button must not scroll with catalog');const pending=n.props.onPress();assert.equal(states[11],true,'must stay open until save succeeds');assert.equal(states[6],true);release();await pending;assert.equal(states[11],false);
 fresh();saveImpl=async()=>{throw Error('저장소 실패')};await saveButton().n.props.onPress();assert.equal(states[11],true);assert(states[5].includes('저장소 실패'));assert.equal(states[6],false);
 fresh();saveImpl=async p=>p;notifyImpl=async()=>{throw Error('지갑 반영 실패')};await saveButton().n.props.onPress();assert.equal(states[11],true);assert(states[5].includes('지갑 반영 실패'));
 console.log('PASS footer outside scroll; close only after successful save; storage and wallet callback failures keep picker open with error');
})().catch(e=>{console.error(e);process.exitCode=1});
