const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
const modules={};let states=[],si=0,opened=0;
const React={createElement:(type,props,...children)=>({type,props:{...props,children:children.flat(Infinity)}}),useState:init=>{const i=si++;if(!(i in states))states[i]=typeof init==='function'?init():init;return[states[i],next=>states[i]=typeof next==='function'?next(states[i]):next]}};
const native={StyleSheet:{create:x=>x,absoluteFillObject:{position:'absolute',top:0,right:0,bottom:0,left:0}}};for(const name of ['ActivityIndicator','Image','Text','TouchableOpacity','View'])native[name]=name;
function load(name){if(modules[name])return modules[name];const context={exports:{},require:source=>{
if(source==='react')return{...React,default:React,__esModule:true};if(source==='react-native')return native;
if(source.endsWith('.png')){assert(fs.existsSync(path.resolve(path.dirname(name),source)));return{uri:source};}
const names={cards:'data/cards.js',cardCatalogCsv:'data/cardCatalogCsv.js',cardRecommendationProducts:'data/cardRecommendationProducts.js'};const key=Object.keys(names).find(key=>source.endsWith('/'+key));if(key)return load(names[key]);throw Error(source);
}};vm.runInNewContext(babel.transformSync(fs.readFileSync(name,'utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);return modules[name]=context.exports;}
const api=load('components/WalletProductCard.js'),catalog=load('data/cardCatalogCsv.js').CSV_CARD_CATALOG,products=load('data/cardRecommendationProducts.js').CARD_PRODUCTS,local=load('data/cards.js');
for(const card of catalog){const result=api.resolveWalletProduct({id:'db-'+card.id,catalogCode:card.code,name:'untrusted',image:{uri:'https://wrong.test/card.png'}});assert(result);assert.equal(result.image,products[card.code].image);assert.equal(result.name,card.name);assert.equal(api.resolveWalletProduct({id:card.code}).key,card.code);assert.equal(api.resolveWalletProduct({id:'named',name:card.name,type:card.type}).key,card.code);}
for(const [id,card] of Object.entries(local.CARD_CATALOG)){const result=api.resolveWalletProduct({id});assert(result);assert.equal(result.name,card.name);}
for(const id of ['shinhan','kb','kpass'])assert.equal(api.resolveWalletProduct(local.DEMO_WALLET_CARDS.find(card=>card.id===id)),null);
assert.equal(api.resolveWalletProduct({id:'unknown',name:'not a product',image:{uri:'https://wrong.test/card.png'}}),null);
const card={id:'user-1',catalogCode:catalog[0].code},product=api.resolveWalletProduct(card);
function render(){si=0;return api.WalletProductCardBody({card,product,onPress:()=>opened++});}
function nodes(n,parents=[]){return n&&typeof n==='object'?[{n,parents},...(n.props?.children||[]).flatMap(child=>nodes(child,[...parents,n]))]:[];}
let tree=render(),image=nodes(tree).find(({n})=>n.type==='Image').n;assert.equal(image.props.resizeMode,'contain');assert.equal(image.props.source,product.image);assert.equal(image.props.style.width,'100%');assert.equal(image.props.style.height,'100%');
const imageFrame=nodes(tree).find(({n})=>n.props.style?.aspectRatio===1.35).n;assert.equal(imageFrame.props.style.maxWidth,360);assert.equal(tree.props.style.maxWidth,440);assert.equal(tree.props.style.width,'100%');
image.props.onError();tree=render();assert(!nodes(tree).some(({n})=>n.type==='Image'));const retry=nodes(tree).find(({n})=>n.props.accessibilityLabel==='지갑 카드 이미지 다시 불러오기');assert(retry);assert(!retry.parents.some(n=>n.type==='TouchableOpacity'));retry.n.props.onPress();assert.equal(opened,0);assert.equal(states[2],1);
image=nodes(render()).find(({n})=>n.type==='Image').n;image.props.onLoad();assert.equal(states[0],false);nodes(render()).find(({n})=>n.type==='TouchableOpacity'&&n.props.accessibilityLabel.includes('결제 화면')).n.props.onPress();assert.equal(opened,1);
const parse=file=>babel.parseSync(fs.readFileSync(file,'utf8'),{configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value){const result=find(child,predicate);if(result)return result;}}else if(value&&typeof value==='object'){const result=find(value,predicate);if(result)return result;}}return null;}
const flat=file=>find(parse(file),node=>node.type==='JSXElement'&&node.openingElement.name.name==='FlatList');
const attr=(node,name)=>node.openingElement.attributes.find(item=>item.name?.name===name);
const old=flat('screens/MainScreen.js.before-real-wallet-image.bak'),current=flat('screens/MainScreen.js');
const clean=value=>JSON.parse(JSON.stringify(value,(key,v)=>['start','end','loc','extra','leadingComments','trailingComments','innerComments'].includes(key)?undefined:v));
assert.deepEqual(clean(old.openingElement.attributes.filter(item=>item.name?.name!=='renderItem')),clean(current.openingElement.attributes.filter(item=>item.name?.name!=='renderItem')));
const oldButton=find(attr(old,'renderItem'),node=>node.type==='JSXElement'&&node.openingElement.name.name==='TouchableOpacity');const newImage=find(attr(current,'renderItem'),node=>node.type==='JSXElement'&&node.openingElement.name.name==='WalletProductCard');assert.deepEqual(clean(attr(oldButton,'onPress')),clean(attr(newImage,'onPress')));
console.log('PASS: all 22 catalog images and 8 PDF product identities; exact product mapping; forged images ignored; unknown demos do not borrow artwork; contain/max-width responsive frame; load/error/retry; retry does not open payment; FlatList paging/touch and original payment callback preserved');
