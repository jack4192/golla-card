const fs=require('node:fs'),vm=require('node:vm'),babel=require('@babel/core'),assert=require('node:assert/strict');
let states=[],index=0,external=0;
const basic=function Basic(){},detail=function Detail(){};
const React={createElement:(type,props)=>({type,props}),useState:init=>{const i=index++;if(!(i in states))states[i]=init;return [states[i],next=>states[i]=next];}};
const context={exports:{},require:name=>name==='react'?{...React,default:React,__esModule:true}:{default:name.includes('Questions')?basic:detail,__esModule:true}};
vm.runInNewContext(babel.transformSync(fs.readFileSync('screens/DailyRoutineScreen.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code,context);
const props={initialDraft:null,onContinue:()=>external++};
function render(){index=0;return context.exports.default(props);}
let tree=render();assert.equal(tree.type,basic);tree.props.onDraftChange({coffee:'always'});tree.props.onContinue();assert.equal(external,0);
tree=render();assert.equal(tree.type,detail);tree.props.onDraftChange([{id:'draft'}]);tree.props.onBack();tree=render();assert.equal(tree.type,basic);assert.equal(tree.props.initialDraft.coffee,'always');tree.props.onContinue();tree=render();assert.equal(tree.props.initialDraft[0].id,'draft');tree.props.onSaved({coffee:'always',detailedRoutine:[{id:'saved'}]});tree.props.onContinue();assert.equal(external,1);
console.log('PASS: question -> details -> parent callback; back retains both drafts; saved profile returned to parent');
