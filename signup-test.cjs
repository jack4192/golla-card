const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
let states=[],refs=[],cursor=0,refCursor=0;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:init=>{const i=cursor++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef:init=>{const i=refCursor++;return refs[i]||(refs[i]={current:init})},useEffect(){}};
const native={};for(const n of ['ActivityIndicator','KeyboardAvoidingView','SafeAreaView','ScrollView','Text','TextInput','TouchableOpacity','View'])native[n]=n;
Object.assign(native,{Keyboard:{dismiss(){}},Platform:{OS:'web'},StyleSheet:{create:x=>x},AppState:{currentState:'active'}});
const context={exports:{},require:n=>n==='react'?{...React,default:React,__esModule:true}:native,console};
const source=fs.readFileSync('screens/SignUpScreen.js','utf8');
vm.runInNewContext(babel.transformSync(source,{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);
const api=context.exports;
function actor(onComplete){states=[];refs=[];const props={onComplete,isIdTaken:()=>false};function render(){cursor=0;refCursor=0;return api.default(props)};function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[]};return{fill(label,value){nodes(render()).find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label).props.onChangeText(value)},async click(label){const n=nodes(render()).find(n=>n.type==='TouchableOpacity'&&nodes(n).some(t=>t.type==='Text'&&t.props.children.some(x=>typeof x==='string'&&x.startsWith(label))));assert(n,label);assert(!n.props.disabled);await n.props.onPress()},render};}
async function fill(a,phone,email){for(const [k,v] of [['이름','가상회원'],['생년월일','19950101'],['아이디','tester'],['전화번호',phone],['이메일',email],['비밀번호','test1234'],['비밀번호 확인','test1234']])a.fill(k,v);await a.click('아이디 확인');await a.click('전화번호 중복 확인');await a.click('이메일 중복 확인');}
(async()=>{
assert.equal(api.formatPhone('01012345678'),'010-1234-5678');assert.equal(api.formatPhone('010-1234-5678'),'010-1234-5678');assert.equal(api.formatPhone('a010x12'),'010-12');assert.equal(api.formatPhone('010123456789'),'010-1234-5678');assert(!api.isValidPhone('010123'));assert(api.isValidBirthDate('20000229'));assert(!api.isValidBirthDate('20010229'));
let captured;let a=actor(async v=>{captured=v});await fill(a,'01012345678','Demo@Example.com');a.fill('전화번호','01022223333');assert.equal(states[2],'');await a.click('회원가입');assert(states[5].includes('전화번호 중복'));await a.click('전화번호 중복 확인');await a.click('회원가입');assert.equal(captured.phone,'01022223333');assert.equal(captured.email,'demo@example.com');
a=actor(async()=>{});a.fill('전화번호','010-2222-3333');await a.click('전화번호 중복 확인');assert(states[5].includes('이미'));assert.equal(states[2],'');a.fill('이메일','DEMO@example.com');await a.click('이메일 중복 확인');assert(states[5].includes('이미'));assert.equal(states[3],'');
a=actor(async()=>{throw Error('synthetic failure')});await fill(a,'01099998888','retry@example.test');await a.click('회원가입');assert(states[5].includes('synthetic failure'));
a=actor(async()=>{});a.fill('전화번호','01099998888');await a.click('전화번호 중복 확인');assert.equal(states[2],'01099998888');a.fill('이메일','retry@example.test');await a.click('이메일 중복 확인');assert.equal(states[3],'retry@example.test');
console.log('PASS phone formatting, invalid number/date, edited-value invalidation, required checks, normalized payload, cross-mount duplicate checks, failed-signup reservation rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
