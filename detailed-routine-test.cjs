const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
const modules={};let saved=null,fail=false;
const native={Platform:{OS:'web'},StyleSheet:{create:v=>v}};
for(const name of ['ActivityIndicator','KeyboardAvoidingView','ScrollView','Text','TextInput','TouchableOpacity','View'])native[name]=name;
const localStorage={getItem:()=>saved,setItem:(k,v)=>{if(fail)throw Error('storage failed');saved=v;},removeItem:()=>{saved=null;}};
let state=[],refs=[],effects=[],si=0,ri=0,external=0,draft=[];
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:init=>{const i=si++;if(!(i in state))state[i]=typeof init==='function'?init():init;return [state[i],next=>state[i]=typeof next==='function'?next(state[i]):next]},useRef:init=>refs[ri++]||(refs[ri-1]={current:init}),useEffect:fn=>effects.push(fn)};
function load(name){if(modules[name])return modules[name];const context={exports:{},window:{localStorage},require:source=>source==='react'?{...React,default:React,__esModule:true}:source==='react-native'?native:source.includes('routineDetails')?load('utils/routineDetails.js'):source.includes('routineData')?load('utils/routineData.js'):{}};
const code=babel.transformSync(fs.readFileSync(name,'utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code;vm.runInNewContext(code,context);return modules[name]=context.exports;}
const details=load('utils/routineDetails.js'),data=load('utils/routineData.js'),screen=load('screens/DetailedRoutineScreen.js');
const row={id:'cafe-1',category:'cafe',start:'930',end:'10:30',nextDay:false,days:[2,1,1],unit:'week',count:'5'};
function plain(value){return JSON.parse(JSON.stringify(value));}
const props={initialDraft:[],onDraftChange:rows=>{draft=rows;},onContinue:()=>external++,onBack:()=>external++};
function render(){si=0;ri=0;return screen.default(props);}
function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[];}
function click(label){const node=nodes(render()).find(n=>n.type==='TouchableOpacity'&&(n.props.accessibilityLabel===label||nodes(n).some(t=>t.type==='Text'&&t.props.children.includes(label))));assert(node,'button '+label);assert(!node.props.disabled,'enabled '+label);return node.props.onPress();}
function input(label,value){const node=nodes(render()).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label);assert(node,label);node.props.onChangeText(value);}
(async()=>{
assert.equal(details.normalizeTime('930'),'09:30');assert.equal(details.normalizeTime('9:30'),'09:30');assert.equal(details.normalizeTime('2400'),null);assert.equal(details.normalizeTime('12:60'),null);
assert.deepEqual(plain(details.validateDetails([row])[0].days),[1,2]);
for(const patch of [{days:[]},{count:0},{count:100},{category:'unknown'},{end:'08:00'},{start:'bad'},{id:''}])assert.throws(()=>details.validateDetails([{...row,...patch}]));
assert.throws(()=>details.validateDetails([row,row]));assert.throws(()=>details.validateDetails(Array.from({length:21},(_,i)=>({...row,id:String(i)}))));
assert.equal(details.validateDetails([{...row,start:'23:00',end:'02:00',nextDay:true}])[0].nextDay,true);
assert.equal(details.detailSignals([row],'2026-11-17').length,1);assert.equal(details.detailSignals([row],'2026-11-18').length,0);
saved=JSON.stringify({occupation:'worker',coffee:'always',otherField:'keep'});
await data.saveDetailedRoutine([row]);assert.equal(JSON.parse(saved).otherField,'keep');assert.equal(JSON.parse(saved).detailedRoutine[0].start,'09:30');
assert(data.makeSignals(await data.readProfile(),[],'2026-11-17').some(x=>x.reasons.some(r=>r.startsWith('직접 설정:'))));
const before=saved;fail=true;await assert.rejects(data.saveDetailedRoutine([]));assert.equal(saved,before);fail=false;
render();assert(!nodes(render()).some(n=>n.type==='Text'&&n.props.children.includes('☕ 카페')));click('업종 선택');click('☕ 카페');assert.equal(draft.length,1);
await click('저장하고 맞춤 카드 보기');assert(state[4].includes('시간'));assert.equal(external,0);
input('1번째 일과 시작 시간','09:00');input('1번째 일과 종료 시간','10:00');click('화요일');input('1번째 일과 이용 횟수','5');
fail=true;await click('저장하고 맞춤 카드 보기');assert.equal(external,0);assert.equal(state[0].length,1);assert.equal(state[4],'storage failed');
fail=false;await click('저장하고 맞춤 카드 보기');assert.equal(external,1);assert.equal(JSON.parse(saved).detailedRoutine.length,1);
await data.deleteProfile();assert.equal(saved,null);
const app=fs.readFileSync('App.js','utf8');assert(!app.includes('DetailedRoutineScreen'));
console.log('PASS: accordion/select; time bounds and overnight; weekdays/frequency; draft retained on failure; no navigation on invalid/save failure; saved profile preserves basic answers; recommendation signals and profile deletion');
})().catch(error=>{console.error(error);process.exitCode=1;});
