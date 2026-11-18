const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],refs=[],si=0,ri=0,effects=[],selected=[],clock=1000,platform='web';
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useRef:init=>{const i=ri++;return refs[i]||(refs[i]={current:init});},useEffect:fn=>effects.push(fn)};
const Native={Platform:{get OS(){return platform;}},StyleSheet:{create:x=>x}};for(const name of ['Text','TouchableOpacity','View'])Native[name]=name;
const context={exports:{},require:name=>name==='react'?{...React,default:React,__esModule:true}:Native};
vm.runInNewContext(babel.transformSync(fs.readFileSync('components/WalletWheelControls.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);
const api=context.exports,cards=['a','b','c'].map(id=>({id}));let position=0,moves=[];
const handler=api.createWalletWheelHandler(()=>({cards,index:position}),index=>{position=index;moves.push(index);},()=>clock);
function wheel(extra={}){let prevented=false;const event={deltaX:0,deltaY:100,deltaMode:0,cancelable:true,preventDefault:()=>{prevented=true;},...extra};const handled=handler(event);return{handled,prevented};}
assert(!wheel({ctrlKey:true}).prevented);assert(!wheel({metaKey:true}).prevented);assert(!wheel({deltaY:0}).prevented);assert(!wheel({deltaY:-100}).prevented);assert.equal(position,0);
assert(wheel().prevented);assert.equal(position,1);clock+=10;assert(wheel().prevented);assert.equal(position,1);clock+=250;assert(wheel().prevented);assert.equal(position,2);assert(!wheel().prevented);
clock+=250;assert(wheel({deltaY:-100}).prevented);assert.equal(position,1);clock+=250;assert(wheel({deltaX:-100,deltaY:1}).prevented);assert.equal(position,0);
clock+=250;for(let i=0;i<3;i++){wheel({deltaY:10});clock+=20;}assert.equal(position,0);wheel({deltaY:10});assert.equal(position,1);
clock+=250;wheel({deltaY:3,deltaMode:1});assert.equal(position,2);assert(!wheel({deltaY:-100,cancelable:false}).prevented);
let props={cards,selectedId:'a',onSelect:id=>selected.push(id),children:'original-wallet'};
function render(){ri=0;return api.default(props);}
function nodes(n){return n&&typeof n==='object'?[n,...(n.props?.children||[]).flatMap(nodes)]:[];}
function button(label){return nodes(render()).find(n=>n.type==='TouchableOpacity'&&n.props.accessibilityLabel===label);}
render();const target=new EventTarget();let options,removed=false;const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
target.addEventListener=(name,fn,opt)=>{options=opt;add(name,fn,opt);};target.removeEventListener=(name,fn,opt)=>{removed=true;remove(name,fn,opt);};refs[0].current=target;
const cleanup=effects.shift()();assert.equal(options.passive,false);assert.equal(options.capture,true);
assert(button('이전 지갑 카드').props.disabled);button('다음 지갑 카드').props.onPress();assert.equal(selected.pop(),'b');
props={...props,selectedId:'b'};render();button('이전 지갑 카드').props.onPress();assert.equal(selected.pop(),'a');
props={...props,selectedId:'a'};render();const event=new Event('wheel',{cancelable:true});Object.defineProperties(event,{deltaY:{value:100},deltaX:{value:0},deltaMode:{value:0}});target.dispatchEvent(event);assert(event.defaultPrevented);assert.equal(selected.pop(),'b');
props={...props,cards:[{id:'new-a'},{id:'new-b'}],selectedId:'new-a'};render();button('다음 지갑 카드').props.onPress();assert.equal(selected.pop(),'new-b');cleanup();assert(removed);
props={...props,cards:[],selectedId:null};render();assert(button('이전 지갑 카드').props.disabled);assert(button('다음 지갑 카드').props.disabled);
function walletBody(file){const ast=babel.parseSync(fs.readFileSync(file,'utf8'),{configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});let body;
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id?.name==='wallet')body=node.init.body;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);if(body.type==='JSXElement'&&body.openingElement.name.name==='WalletWheelControls')body=body.children.find(n=>n.type==='JSXFragment'||n.type==='JSXElement');return body;}
const trim=node=>JSON.parse(JSON.stringify(node,(key,value)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:value));
function flatList(node){if(!node||typeof node!=='object')return null;if(node.type==='JSXElement'&&node.openingElement.name.name==='FlatList')return node;for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value){const result=flatList(child);if(result)return result;}}else if(value&&typeof value==='object'){const result=flatList(value);if(result)return result;}}return null;}
const currentFlat=flatList(walletBody('screens/MainScreen.js')),originalFlat=flatList(walletBody('screens/MainScreen.js.before-wallet-wheel.bak'));
const paging=node=>node.openingElement.attributes.filter(item=>item.name?.name!=='renderItem');
assert.deepEqual(trim(paging(currentFlat)),trim(paging(originalFlat)));
const main=fs.readFileSync('screens/MainScreen.js','utf8');assert.equal((main.match(/<WalletWheelControls\b/g)||[]).length,1);
effects=[];refs=[];platform='ios';props={cards,selectedId:'a',onSelect:id=>selected.push(id)};render();assert.equal(effects.shift()(),undefined);button('다음 지갑 카드').props.onPress();assert.equal(selected.pop(),'b');
console.log('PASS: native wheel cancellation listener; vertical/horizontal input; trackpad accumulation and cooldown; edge page scroll; Ctrl zoom; buttons; dynamic/empty cards; cleanup; original FlatList paging/touch handlers unchanged; single integration');
