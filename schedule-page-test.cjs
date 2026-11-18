const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],refs=[],effects=[],si=0,ri=0,props,record=[],fail=false,changes=0,closed=0,confirmed=0,saves=0;
const React={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next]},useRef:init=>{const i=ri++;return refs[i]||(refs[i]={current:init})},useEffect:fn=>effects.push(fn)};
const native={Platform:{OS:'web'},StyleSheet:{create:x=>x}};for(const name of ['ActivityIndicator','KeyboardAvoidingView','Modal','SafeAreaView','ScrollView','Text','TextInput','TouchableOpacity','View'])native[name]=name;
const routine={EVENT_OPTIONS:[['hospital','병원 예약'],['travel','여행']],dateKey:()=> '2026-11-18',eventLabel:x=>x,validDate:x=>/^\d{4}-\d{2}-\d{2}$/.test(x),shiftDate:(date,days)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)},readEvents:async()=>{if(fail)throw Error('read failed');return record},saveEvent:async value=>{saves++;if(fail)throw Error('save failed');const item={...value,id:value.id||'saved-1'};record=[item,...record.filter(row=>row.id!==item.id)];return item},deleteEvent:async id=>{if(fail)throw Error('delete failed');record=record.filter(row=>row.id!==id)},confirmToday:async()=>{if(fail)throw Error('confirm failed')}};
const context={exports:{},require:name=>name==='react'?{...React,default:React,__esModule:true}:name==='react-native'?native:routine};
vm.runInNewContext(babel.transformSync(fs.readFileSync('components/SpecialScheduleModal.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);
props={visible:true,onClose:()=>closed++,onChanged:()=>changes++,onConfirmed:()=>confirmed++};
function render(){si=0;ri=0;return context.exports.default(props)}
function nodes(n,parents=[]){return n&&typeof n==='object'?[{n,parents},...(n.props?.children||[]).flatMap(child=>nodes(child,[...parents,n]))]:[]}
function button(label){const item=nodes(render()).find(({n})=>n.type==='TouchableOpacity'&&(n.props.accessibilityLabel===label||nodes(n).some(({n:t})=>t.type==='Text'&&t.props.children.includes(label))));assert(item,label);return item.n;}
function click(label){const n=button(label);assert(!n.props.disabled,'enabled '+label);return n.props.onPress();}
function input(label,value){const item=nodes(render()).find(({n})=>n.type==='TextInput'&&n.props.accessibilityLabel===label);assert(item);item.n.props.onChangeText(value);}
(async()=>{
 const first=render();assert.equal(first.props.transparent,false);assert.equal(first.props.presentationStyle,'fullScreen');effects.splice(0).forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(states[5],false);assert.equal(render().props.visible,true);
 const footerButton=nodes(render()).find(({n})=>n.type==='TouchableOpacity'&&nodes(n).some(({n:t})=>t.type==='Text'&&t.props.children.includes('오늘 일정 확인 완료')));assert(!footerButton.parents.some(n=>n.type==='ScrollView'));
 click('병원 예약');input('일정 메모','검진 일정');click('다음 날 →');assert.equal(states[0],'2026-11-18');assert(states[7].includes('먼저 저장'));
 click('일정 화면 뒤로 가기');assert.equal(closed,1);assert.equal(states[4],'검진 일정');props.visible=false;render();props.visible=true;render();assert.equal(states[3][0],'hospital');
 fail=true;await click('일정 추가');assert.equal(states[4],'검진 일정');assert.equal(states[3][0],'hospital');assert.equal(changes,0);assert.equal(states[7],'save failed');fail=false;
 await click('일정 추가');assert.equal(record.length,1);assert.equal(states[1].length,1);assert.equal(states[4],'');assert.equal(changes,1);
 click('수정');input('일정 메모','수정한 일정');await click('수정 내용 저장');assert.equal(record.length,1);assert.equal(record[0].memo,'수정한 일정');
 fail=true;await click('삭제');assert.equal(states[1].length,1);fail=false;await click('삭제');assert.equal(states[1].length,0);
 click('병원 예약');await click('오늘 일정 확인 완료');assert.equal(confirmed,0);click('입력 취소');fail=true;await click('오늘 일정 확인 완료');assert.equal(confirmed,0);assert.equal(closed,1);fail=false;await click('오늘 일정 확인 완료');assert.equal(confirmed,1);assert.equal(closed,2);
 click('다음 날 →');assert.equal(states[0],'2026-11-19');assert(!nodes(render()).some(({n})=>n.type==='Text'&&n.props.children.includes('오늘 일정 확인 완료')));click('오늘');
 props.readOnly=true;assert(button('일정 추가').props.disabled);const before=saves;await button('일정 추가').props.onPress();assert.equal(saves,before);
 props.readOnly=false;states[6]='load failed';await button('오늘 일정 확인 완료').props.onPress();assert.equal(confirmed,1);
 console.log('PASS: opaque full screen; back restores caller; fixed footer; saved/unsaved draft preserved; add/edit/delete; save/delete/confirm failures; date-change draft protection; today-only confirmation; readonly/load-error mutation guards');
})().catch(error=>{console.error(error);process.exitCode=1});
