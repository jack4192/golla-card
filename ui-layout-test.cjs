const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
const ast=babel.parseSync(fs.readFileSync('screens/MainScreen.js','utf8'),{configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
let width,handler;
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='VariableDeclarator'&&node.id?.name==='cardWidth')width=node.init;if(node.type==='VariableDeclarator'&&node.id?.name==='wallet'){const root=node.init.body;handler=root.openingElement.attributes.find(item=>item.name?.name==='onLayout').value.expression;}for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);assert(width&&handler);
function code(expression){return babel.transformFromAstSync({type:'File',program:{type:'Program',sourceType:'module',body:[{type:'ExpressionStatement',expression}]}},'',{configFile:false,babelrc:false}).code;}
let measured=316,changed=0,selected='existing-card';const context={width:1920,walletViewportWidth:measured,setWalletViewportWidth:fn=>{const value=fn(measured);if(value!==measured)changed++;measured=value;},onSelectCard:()=>{throw Error('Resize must not select another payment card');}};
const layout=vm.runInNewContext(code(handler),context);
const fire=value=>layout({nativeEvent:{layout:{width:value}}});
for(const value of [0,-1,NaN,Infinity])fire(value);assert.equal(measured,316);assert.equal(changed,0);
fire(316.3);fire(315.8);assert.equal(changed,0);fire(996.2);assert.equal(measured,996);assert.equal(changed,1);
for(const [windowWidth,viewport] of [[1920,996],[360,316],[320,276],[820,720]]){context.width=windowWidth;context.walletViewportWidth=viewport;assert.equal(vm.runInNewContext(code(width),context),viewport);}
assert.equal(selected,'existing-card');assert.equal((fs.readFileSync('screens/MainScreen.js','utf8').match(/\[walletViewportWidth, setWalletViewportWidth\]/g)||[]).length,1);
console.log('PASS: measured carousel width wins over desktop/mobile window width; invalid layout events ignored; fractional layout does not loop; resizing does not change selected card; single layout state');
