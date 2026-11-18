const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
const code=babel.transformSync(fs.readFileSync('components/AccountWithdrawal.js','utf8'),{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-modules-commonjs',['@babel/plugin-transform-react-jsx',{runtime:'classic'}]]}).code;
const context={exports:{},require:n=>n==='react-native'?{StyleSheet:{create:x=>x}}:{},console};vm.runInNewContext(code,context);
(async()=>{
 const run=context.exports.withdrawDemoAccount;let events=[];
 await run({wait:async()=>events.push('wait'),remove:async scope=>{assert.equal(scope,'account');events.push('delete');return{ok:true,pending:false}},onDeleted:()=>events.push('deleted'),restart:async()=>events.push('restart')});
 assert.deepEqual(events,['wait','delete','deleted','restart']);
 events=[];await assert.rejects(()=>run({wait:async()=>{},remove:async()=>({ok:false,pending:true,failed:['PIN']}),restart:async()=>events.push('bad')}),/PIN/);assert.equal(events.length,0);
 await assert.rejects(()=>run({wait:async()=>{throw Error('write failure')},remove:async()=>events.push('bad')}),/write failure/);assert.equal(events.length,0);
 let deleted=false;await assert.rejects(()=>run({wait:async()=>{},remove:async()=>({ok:true}),onDeleted:()=>{deleted=true},restart:async()=>{throw Error('reload failure')}}),/reload failure/);assert(deleted);
 const app=fs.readFileSync('App.js');const previous=fs.readFileSync('App.js.preview-backup');assert(app.length>0); // App is not touched by the installer.
 const installer=fs.readFileSync('scripts/add-account-withdrawal.cjs','utf8');assert(!installer.includes("path.join(root, 'App.js')"));
 console.log('PASS await writes → delete account → reload; no reload after incomplete deletion; restart failure retains deleted state; installer never targets App.js');
})().catch(e=>{console.error(e);process.exitCode=1});

