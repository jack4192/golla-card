const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
const root=process.cwd(), records=new Map();let fail=false;const storage={getItemAsync:async k=>records.get(k)||null,setItemAsync:async(k,v)=>{if(fail)throw Error('storage unavailable');records.set(k,v)},deleteItemAsync:async k=>records.delete(k)};
const cache=new Map();function load(p){p=path.resolve(p);if(cache.has(p))return cache.get(p).exports;if(p.endsWith('.json'))return JSON.parse(fs.readFileSync(p,'utf8'));const m={exports:{}};cache.set(p,m);
 const primitive=tag=>({children})=>require('react').createElement(tag,null,children);
 const req=n=>{if(n==='react-native')return{Platform:{OS:'web'},View:primitive('div'),Text:primitive('span'),ScrollView:primitive('div'),TouchableOpacity:primitive('button'),ActivityIndicator:primitive('span')};if(n.endsWith('demoStore'))return storage;if(n.endsWith('.png'))return{uri:n};if(n.startsWith('.')){let target=path.resolve(path.dirname(p),n);if(!path.extname(target))target+='.js';return load(target)}return require(n)};
 const source=babel.transformSync(fs.readFileSync(p,'utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code;
 vm.runInNewContext(source,{exports:m.exports,module:m,require:req,console,setTimeout,clearTimeout,window:{localStorage:{getItem:()=>null,removeItem(){}}}},{filename:p});return m.exports;}
(async()=>{
 const s=load('utils/myDataService.js'), fixtures=load('data/myDataFixture.json');
 assert.equal(Object.keys(fixtures).length,5);assert.equal(JSON.stringify(fixtures).includes('password_hash'),false);assert.equal(JSON.stringify(fixtures).includes('phone'),false);
 for(const f of Object.values(fixtures)){assert.equal(f.coverageMonths,6);assert.equal(f.transactionCount,f.transactions.length);assert.equal(f.transactions.reduce((n,r)=>n+r.amount,0),f.total);assert(Math.abs(f.weekdays.reduce((n,r)=>n+r.share,0)-1)<1e-9);assert(f.transactions.every(t=>t.date>='2026-05-01'&&t.date<'2026-11-01'));assert(f.cards.every(c=>c.status.caps.every(cap=>cap.used===null||(cap.remaining>=0&&cap.remaining<=cap.limit))));}
 let events=[];const off=s.subscribeMyData(v=>events.push(v?.userId));let steps=[];const a=await s.importMyData('1',v=>steps.push(v));assert.deepEqual(Array.from(steps),[0,1,2,3]);assert.equal(a.cards.length,3);assert(a.cards.every(c=>c.isImportedMyData&&c.isOwned));
 const combined=s.mergeImportedWallet([{id:'legacy-demo'},{id:'manual',name:'가상직접등록',type:'신용',isManuallyRegistered:true}],a);assert.equal(combined.length,4);assert(combined.some(c=>c.id==='manual'));assert(!combined.some(c=>c.id==='legacy-demo'));
 fail=true;await assert.rejects(()=>s.importMyData('2'),/storage unavailable/);fail=false;assert.equal(s.getMyDataSnapshot().userId,'1');
 await assert.rejects(()=>s.importMyData('2',()=>{},{isCancelled:()=>true}),/취소/);assert.equal(s.getMyDataSnapshot().userId,'1');
 s.clearMyDataMemory();await s.restoreMyData();assert.equal(s.getMyDataSnapshot().userId,'1');
 await Promise.all([s.importMyData('2'),s.importMyData('3')]);assert.equal(s.getMyDataSnapshot().userId,'3');
 const privacy=load('utils/privacyData.js');const report=await privacy.deleteDemoData('personal');assert(report.ok);assert(!records.has(s.MYDATA_KEY));assert.equal(s.getMyDataSnapshot(),null);off();
 const React=require('react'),ReactDOM=require('react-dom/server');
 await s.importMyData('1');const Panel=load('components/MyDataCardStatus.js').default,Result=load('screens/MyDataScreen.js').default,Loading=load('screens/MyDataLoadingScreen.js').default;
 for(const [component,props] of [[Panel,{card:s.getMyDataSnapshot().cards[0],expanded:true}],[Result,{}],[Loading,{}]]){
  const html=ReactDOM.renderToStaticMarkup(React.createElement(component,props));assert(html.length>100);assert(!html.includes('NaN'));assert(!html.includes('undefined'));}
 console.log('PASS five data cohorts: dates/counts/amounts/shares/caps; import stages; owned-card merge; failed-write rollback; cancellation; restore; serialized imports; withdrawal/personal deletion cleanup');
})().catch(e=>{console.error(e);process.exitCode=1});
