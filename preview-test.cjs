const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm'), babel = require('@babel/core');
const states=[], refs=[]; let cursor=0, refCursor=0;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat()}}),Fragment:'Fragment',useState:init=>{const i=cursor++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value]},useRef:init=>refs[refCursor++]|| (refs[refCursor-1]={current:init}),useEffect:()=>{}};
const cards=[{id:'a',name:'A'},{id:'b',name:'B'}];
function load(name){
 if(name==='react')return {...React,default:React,__esModule:true};
 if(name==='react-native')return {View:'View',Text:'Text',ScrollView:'ScrollView',TouchableOpacity:'Button',ActivityIndicator:'Spinner',Keyboard:{dismiss(){}},Platform:{OS:'web'},StyleSheet:{create:x=>x,absoluteFillObject:{}}};
 if(name.endsWith('/cards'))return{DEMO_WALLET_CARDS:cards,getActiveWalletCard:(xs,id)=>xs.find(x=>x.id===id)||xs[0]};
 if(name.endsWith('/wallet'))return{buildWallet:()=>cards,readWallet:async()=>({cards,id:'a',preferences:{owned:['b']}}),validWalletId:(xs,id)=>id,walletIdForCode:x=>x,saveWalletSelection:async()=>{},waitForWalletWrites:async()=>{}};
 if(name.endsWith('/demoAlert'))return{Alert:{alert(){}}};
 if(name.startsWith('./screens/')||name.startsWith('./components/'))return{default:name.split('/').pop(),__esModule:true};
 return{};
}
const source=fs.readFileSync('App.js','utf8');
const compiled=babel.transformSync(source,{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code;
const context={exports:{},require:load,__DEV__:true,console};vm.runInNewContext(compiled,context);
const App=context.exports.default;
function render(){cursor=0;refCursor=0;return App();}
function all(node){if(!node||typeof node!=='object')return[];return[node,...(node.props?.children||[]).flatMap(all)];}
function screen(name){return all(render()).filter(n=>n.type===name).at(-1);}
render();states[5]=false;
let tree=render();all(tree).find(n=>n.type==='Button'&&n.props.style?.position==='absolute').props.onPress();
tree=render();const labels=all(tree).filter(n=>n.type==='Button');
labels.find(n=>all(n).some(c=>c.type==='Text'&&c.props.children.includes('1. 아이디 로그인'))).props.onPress();
(async()=>{
 assert.equal(states[6],false);
 await screen('LoginScreen').props.onLogin('demo','1234');
 assert(screen('AgreementScreen'));
 await screen('AgreementScreen').props.onNext({myDataAgreed:true});
 assert.equal(screen('PinSetupScreen').props.readOnly,false);
 await screen('PinSetupScreen').props.onNext('123456');
 assert.equal(screen('DailyRoutineScreen').props.readOnly,false);
 screen('DailyRoutineScreen').props.onContinue();
 await screen('RoutineRecommendationScreen').props.onNext();
 screen('MainScreen').props.onSelectCard('b');
 assert.equal(screen('MainScreen').props.activeCardId,'b');
 await screen('MainScreen').props.onLogout();
 assert(screen('LoginScreen'));
 assert.equal(states[6],false);
 assert(!source.includes('pointerEvents="none"'));
 console.log('PASS developer Login→Agreement→PIN→Routine→Recommendation→Main→Logout; interactive card select, no auth mutation');
})().catch(e=>{console.error(e);process.exitCode=1});
