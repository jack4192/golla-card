const fs=require('fs'),vm=require('vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],refs=[],sc=0,rc=0,record=null,fail=false,selectedCalls=0;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),useState:init=>{const i=sc++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef:init=>{const i=rc++;return refs[i]||(refs[i]={current:init})},useEffect(){},useMemo:fn=>fn()};
const native={StyleSheet:{create:x=>x}};for(const n of ['ActivityIndicator','Image','Modal','ScrollView','Text','TouchableOpacity','View'])native[n]=n;
const store={getItemAsync:async()=>record,setItemAsync:async(k,v)=>{if(fail)throw Error('storage failure');record=v}};
const ctx={exports:{},require:n=>n==='react'?{...React,default:React,__esModule:true}:n==='react-native'?native:store};
vm.runInNewContext(babel.transformSync(fs.readFileSync('components/PaymentCardOrder.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,ctx);
const api=ctx.exports,cards=['a','b','c'].map(id=>({id,name:id,issuer:'test'}));
function render(){sc=0;rc=0;return api.default({cards,selectedId:'b',onSelect:()=>selectedCalls++})}
function nodes(n,parents=[]){return n&&typeof n==='object'?[{n,parents},...(n.props?.children||[]).flatMap(x=>nodes(x,[...parents,n]))]:[]}
function click(label){const match=nodes(render()).find(({n})=>n.type==='TouchableOpacity'&&(n.props.accessibilityLabel===label||nodes(n).some(({n:t})=>t.type==='Text'&&t.props.children.includes(label))));assert(match,label);return match.n.props.onPress()}
(async()=>{
 assert.deepEqual(Array.from(api.orderCards(cards,['c','a','deleted']).map(c=>c.id)),['c','a','b']);assert.deepEqual(cards.map(c=>c.id),['a','b','c']);assert.throws(()=>api.validateCardOrder('{broken'));
 assert.deepEqual(Array.from(api.moveCard(['a','b'],0,-1)),['a','b']);render();states[3]=false;
 click('수정');click('b 위로 이동');assert.deepEqual(Array.from(states[1]),['b','a','c']);assert.equal(selectedCalls,0);click('취소');assert.equal(record,null);assert.deepEqual(Array.from(states[0]),[]);
 click('수정');click('b 위로 이동');fail=true;await click('순서 저장');assert(states[2]);assert(states[6].includes('storage failure'));assert.equal(record,null);assert.equal(selectedCalls,0);
 fail=false;await click('순서 저장');assert(!states[2]);assert.deepEqual(JSON.parse(record).ids,['b','a','c']);assert.deepEqual(Array.from(api.validateCardOrder(record)),['b','a','c']);assert.equal(selectedCalls,0);
 assert(fs.readFileSync('utils/privacyData.js','utf8').includes('solpay_payment_card_order_v1'));
 const pay=fs.readFileSync('screens/PaymentScreen.js','utf8');assert.equal((pay.match(/<PaymentCardOrder\b/g)||[]).length,1);
 console.log('PASS move bounds/new or removed cards; cancel preserves saved order; save failure retains editor; restore persisted order; reorder never selects a card; deletion key and single integration');
})().catch(e=>{console.error(e);process.exitCode=1});
