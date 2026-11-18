const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
const parse = code => babel.parseSync(code, {configFile:false,babelrc:false,parserOpts:{plugins:['jsx']}});
const T = {bg:'#F4F7FB', white:'#FFFFFF', ink:'#142D4E', muted:'#5A6E89', blue:'#245DE5', soft:'#EDF3FF', line:'#E3EAF4', red:'#C53D56'};
const colors = new Map();
function group(to, values){values.split(' ').forEach(value=>colors.set(value.toUpperCase(),to));}
group(T.bg, '#F5F8FF #F5F7FC #F5F8FD #F6F8FC #F6F8FD #F4F6FB #F7F9FC #F8F9FA #FAFAFA');
group(T.white, '#FFF #FFFFFF');
group(T.soft, '#EAF1FF #EDF3FF #EDF4FF #F0F5FF #EAF2FF #EDF3FC #E8F0FF');
group(T.line, '#E5E5EA #E5E5E5 #DDD #EEEEEE #EEE #E7EDF7 #E3EAF5 #E6EEFB #DEE6F1 #DFE6F2 #E7ECF3 #ECF0F7 #EDF1F7 #D7E1EF');
group(T.blue, '#245DE5 #245DEA #245CEA #255DE5 #2457AB #315C9D #0046FF #2360E7 #2860E6');
group(T.ink, '#1A1A1A #152B50 #172B50 #162D50 #173258 #183252 #1D2B44 #213D68 #213D63 #203D66 #233D62 #233E63 #263D60');
group(T.muted, '#767676 #718096 #71819B #77859B #77879E #7C8AA1 #7C8EA8 #8290A6 #8391A7 #8393AC #8798B1 #8698B5 #8D9AB0 #91A0B7 #98A4B5 #8996A8 #9BA4B3 #768299 #637DAB #8290A6 #97A1B0');
group(T.red, '#B6364E #B93751 #B83850 #B53C52 #BB3048 #C54141 #D93025 #C54444');
const center = maxWidth => ({width:'100%',maxWidth,alignSelf:'center'});
const page = maxWidth => ({...center(maxWidth),padding:22,paddingTop:28,paddingBottom:40,gap:18});
const primary = {minHeight:54,padding:16,borderRadius:16,backgroundColor:T.blue,alignItems:'center',justifyContent:'center'};
const footerButton = {...center(552),width:'90%',margin:0,marginTop:12,marginBottom:20};
const input = {minHeight:52,padding:15,fontSize:16,borderWidth:1,borderColor:T.line,borderRadius:14,backgroundColor:T.white,color:T.ink};
const common = {
  primary, secondary:{minHeight:46,padding:14,borderRadius:14,backgroundColor:T.soft,alignItems:'center',justifyContent:'center'},
  input, hint:{fontSize:13,lineHeight:22,color:T.muted}, caption:{fontSize:12,lineHeight:21,color:T.muted},
  subtitle:{fontSize:14,lineHeight:24,color:T.muted}, description:{fontSize:14,lineHeight:24,color:T.muted},
  error:{fontSize:13,lineHeight:22,color:T.red}, link:{fontSize:13,fontWeight:'700',color:T.blue},
  blue:{fontSize:13,fontWeight:'700',color:T.blue}, white:{fontSize:15,fontWeight:'700',color:T.white},
  selected:{backgroundColor:T.soft,borderColor:T.blue}, checked:{backgroundColor:T.soft,borderColor:T.blue},
};
const overrides = {
  MainScreen:{
    root:{backgroundColor:T.bg},topBar:{...center(1040),paddingHorizontal:22,paddingVertical:16,borderBottomWidth:0},
    pageContent:page(1040),brand:{fontSize:25,fontWeight:'800',color:T.ink},brandCaption:{fontSize:11,color:T.muted,letterSpacing:1},
    hero:{backgroundColor:T.blue,borderRadius:24,padding:24,marginBottom:0},heroTitle:{fontSize:28,lineHeight:39,fontWeight:'800'},
    heroEyebrow:{fontSize:12,lineHeight:19,letterSpacing:0.8},heroSub:{fontSize:14,lineHeight:23},heroAction:{minHeight:46},
    sectionHeader:{marginTop:12,marginBottom:0},sectionTitle:{fontSize:19,lineHeight:28,fontWeight:'800',color:T.ink},
    walletBenefitBox:{marginTop:0,borderRadius:22,padding:20,borderColor:T.line},walletBenefitHeadingText:{fontSize:16,lineHeight:24},
    walletBenefitFootnote:{fontSize:12,lineHeight:21,color:T.muted},benefitTile:{borderRadius:20,padding:18,borderWidth:1,borderColor:T.line},
    ruleCard:{borderRadius:20,padding:20},financeBox:{borderRadius:20},cardListItem:{borderRadius:18,padding:16},
    bottomNav:{...center(1040),paddingTop:10,paddingBottom:12,borderTopColor:T.line},navItem:{minHeight:48},
    navLabel:{fontSize:12,lineHeight:18,color:T.muted},navLabelActive:{color:T.blue},iconCircle:{width:44,height:44,borderRadius:14},
    modalPanel:{...center(620),borderRadius:24},modalBody:{padding:24},settingsHeader:{...center(800)},
    settingsContent:{...center(800),paddingHorizontal:16,paddingBottom:28,gap:12},settingGroup:{borderRadius:20,overflow:'hidden',marginTop:0},
    settingRow:{paddingVertical:17,borderBottomColor:T.line},settingSubtitle:{fontSize:12,lineHeight:21,color:T.muted},settingsFooter:{color:T.muted,lineHeight:21},
    pinModalCard:{...center(480),borderRadius:24,padding:24},chatRoot:{backgroundColor:T.bg},chatInput:{minHeight:48,borderRadius:14},
  },
  LoginScreen:{safeArea:{backgroundColor:T.bg},container:{...center(480),paddingHorizontal:24},logo:{fontSize:36,lineHeight:46,fontWeight:'800',letterSpacing:-1,color:T.blue},heading:{marginBottom:32},button:primary,form:{marginBottom:20}},
  SignUpScreen:{content:page(600),back:{...center(600),paddingHorizontal:22},button:{...primary,...footerButton}},
  AgreementScreen:{content:page(640),primary:{...primary,...footerButton},checkRow:{minHeight:64,borderRadius:18,padding:18,backgroundColor:T.white},square:{borderRadius:7},box:{padding:20,borderRadius:20,backgroundColor:T.white}},
  PinSetupScreen:{body:{...center(560),gap:20},back:{...center(560),marginTop:16},button:{...primary,...center(560)},card:{padding:24,borderRadius:22}},
  PinLoginScreen:{center:{...center(520)},logo:{color:T.blue},other:{...center(520)}},
  DailyRoutineQuestionsScreen:{body:page(720),card:{padding:22,borderRadius:22,borderWidth:1,borderColor:T.line},question:{fontSize:17,lineHeight:26},progress:{alignSelf:'flex-start',paddingVertical:8,paddingHorizontal:12,backgroundColor:T.soft,borderRadius:12},option:{minHeight:46,padding:13,borderRadius:13}},
  DetailedRoutineScreen:{body:page(720),card:{padding:22,borderRadius:22,borderWidth:1,borderColor:T.line},chip:{minHeight:46,borderRadius:13},footerRow:center(676),footer:{padding:18,paddingBottom:26,borderColor:T.line}},
  RoutineRecommendationScreen:{content:{padding:20,paddingTop:28,paddingBottom:36},container:{...center(560),gap:16},hero:{borderRadius:26,padding:22,borderColor:T.line},title:{fontSize:28,lineHeight:39,fontWeight:'800'},demo:{fontSize:12,lineHeight:20,color:T.muted},reason:{fontSize:16,lineHeight:27,color:T.muted},badge:{padding:18,borderRadius:18},choice:{minHeight:58},circle:{width:42,height:42,borderRadius:21}},
  RoutinePatternRecommendationScreen:{container:{...center(560)},headline:{fontSize:28,lineHeight:39},hero:{borderRadius:26,borderColor:T.line},reasonText:{fontSize:16,lineHeight:27}},
  PaymentScreen:{container:{...center(560),gap:18},content:{padding:20,paddingBottom:64},hero:{padding:22,borderRadius:24,borderColor:T.line},box:{padding:20,borderRadius:22,borderColor:T.line},heading:{fontSize:18,lineHeight:27},codes:{backgroundColor:T.white},codeNumber:{letterSpacing:1.5},demo:{fontSize:12,lineHeight:20,color:T.muted}},
  SpecialScheduleModal:{body:page(760),header:{minHeight:62},card:{padding:22,borderRadius:22,borderWidth:1,borderColor:T.line},footerRow:center(716),footer:{padding:18,paddingBottom:24},option:{minHeight:46,padding:13}},
  TodaySchedulePanel:{panel:{...center(1040),backgroundColor:T.white,paddingHorizontal:22,paddingVertical:16,gap:10,borderBottomColor:T.line},title:{fontSize:16,lineHeight:24,color:T.ink},summary:{fontSize:13,lineHeight:22,color:T.muted},row:{gap:8},primary:{...primary,minHeight:44,padding:12},secondary:{minHeight:44,padding:12}},
  WalletProductCard:{card:{borderRadius:24,borderColor:T.line,padding:18},name:{fontSize:19,lineHeight:28},issuer:{fontSize:12,lineHeight:20,color:T.muted}},
  WalletWheelControls:{button:{minHeight:46,paddingHorizontal:16,borderRadius:14,backgroundColor:T.soft},count:{fontSize:13},hint:{fontSize:12,lineHeight:20,color:T.muted}},
  PaymentCardOrder:{box:{borderRadius:22,padding:20,borderColor:T.line},item:{padding:14,borderRadius:16,borderColor:T.line},selected:{backgroundColor:T.soft,borderColor:T.blue},modalHeader:{padding:22},list:{padding:18,gap:14},draftItem:{borderRadius:18,padding:16},footer:{padding:18,paddingBottom:30},footerRow:center(680)},
  RecommendationLaunchPopup:{sheet:{maxWidth:600,borderRadius:28},header:{paddingLeft:22},title:{fontSize:14,lineHeight:23},footer:{padding:16,paddingBottom:26},done:{minHeight:48,borderRadius:14,justifyContent:'center'},hide:{minHeight:48,borderRadius:14,justifyContent:'center'}},
  AccountWithdrawal:{panel:{...center(600),borderRadius:26},content:{padding:24,gap:18},entry:{minHeight:48}},
  PrivacyDataModal:{sheet:{...center(620),borderRadius:26},body:{padding:24,gap:18}},
  TodayBenefitPanel:{modal:{...center(720),borderRadius:26},content:{padding:24,gap:16},banner:{borderRadius:20,padding:18},title:{fontSize:25,lineHeight:36}},
  CardManageScreen:{screen:{...center(760),padding:22,backgroundColor:T.bg},header:{marginTop:16},searchInput:input,cardItem:{backgroundColor:T.white,borderColor:T.line,borderRadius:20},btnPrimary:primary,btnAdd:{minHeight:44,justifyContent:'center'}},
  MyDataAuthScreen:{content:page(600),bottomButton:{...primary,...footerButton}},
  MyDataResultScreen:{content:page(720),bottomButton:{...primary,...footerButton}},
};
const touchKeys = new Set(['primary','secondary','button','small','retry','edit','back','save','cancel','arrow','confirmButton','returnButton','btnPrimary','btnAdd','bottomButton','outlineButton','option','chip','tab','choice','done','hide']);
function valueNode(value){
  if(typeof value==='string')return {type:'StringLiteral',value};
  if(typeof value==='number')return {type:'NumericLiteral',value};
  if(typeof value==='boolean')return {type:'BooleanLiteral',value};
  if(value===null)return {type:'NullLiteral'};
  return {type:'ObjectExpression',properties:Object.entries(value).map(([key,item])=>({type:'ObjectProperty',key:{type:'Identifier',name:key},value:valueNode(item),computed:false,shorthand:false}))};
}
const keyName = property => property.key?.name || property.key?.value;
const property = (object,key) => object.properties.find(item=>item.type==='ObjectProperty'&&keyName(item)===key);
function set(object,key,value){const item=property(object,key);if(item)item.value=valueNode(value);else object.properties.push({type:'ObjectProperty',key:{type:'Identifier',name:key},value:valueNode(value),computed:false,shorthand:false});}
function merge(object,values){for(const [key,value] of Object.entries(values))set(object,key,value);}
function soften(object){
  for(const item of object.properties){
    if(item.type!=='ObjectProperty')continue;
    const key=keyName(item),value=item.value;
    if(/color$/i.test(key)&&value.type==='StringLiteral'&&colors.has(value.value.toUpperCase()))item.value=valueNode(colors.get(value.value.toUpperCase()));
    if(key==='fontSize'&&value.type==='NumericLiteral'&&value.value>=9&&value.value<12)item.value=valueNode(12);
    if(key==='fontWeight'&&value.type==='StringLiteral'&&value.value==='900')item.value=valueNode('800');
  }
  const size=property(object,'fontSize')?.value, line=property(object,'lineHeight')?.value;
  if(size?.type==='NumericLiteral'&&line?.type==='NumericLiteral'&&line.value<size.value*1.35)set(object,'lineHeight',Math.ceil(size.value*1.4));
}
function styleSheet(object,name){
  for(const item of object.properties){
    if(item.type!=='ObjectProperty'||item.value.type!=='ObjectExpression')continue;
    const key=keyName(item),style=item.value;
    soften(style);
    if(common[key])merge(style,common[key]);
    if(touchKeys.has(key)&&!property(style,'height')){
      const min=property(style,'minHeight')?.value;
      if(!min||min.type==='NumericLiteral'&&min.value<44)set(style,'minHeight',44);
    }
    if(['screen','safeArea'].includes(key))set(style,'backgroundColor',T.bg);
    if(key==='title'&&property(style,'fontSize')){
      merge(style,{fontWeight:'800',color:T.ink});
      const size=property(style,'fontSize').value;
      if(size.type==='NumericLiteral'&&size.value>=22)merge(style,{fontSize:28,lineHeight:39});
    }
    if(['card','box'].includes(key)){
      merge(style,{borderRadius:22,borderWidth:1,borderColor:T.line});
      if(!property(style,'backgroundColor'))set(style,'backgroundColor',T.white);
    }
    if(overrides[name]?.[key])merge(style,overrides[name][key]);
  }
}
function walk(node,fn){if(!node||typeof node!=='object')return;fn(node);for(const child of Object.values(node)){if(Array.isArray(child))child.forEach(item=>walk(item,fn));else if(child&&typeof child==='object')walk(child,fn);}}
function mainLayout(ast){
  let width=0,wallet=0;
  const main=ast.program.body.find(item=>item.type==='ExportDefaultDeclaration'&&item.declaration.id?.name==='MainScreen')?.declaration;
  if(!main||main.type!=='FunctionDeclaration')throw Error('MainScreen 구조를 확인해주세요. 변경하지 않았습니다.');
  const hasState=main.body.body.some(item=>item.type==='VariableDeclaration'&&item.declarations.some(item=>item.id.type==='ArrayPattern'&&item.id.elements[0]?.name==='walletViewportWidth'));
  if(!hasState)main.body.body.unshift(parse('const [walletViewportWidth,setWalletViewportWidth]=useState(0);').program.body[0]);
  const attach=element=>{
    if(element.type!=='JSXElement')return false;
    const name=element.openingElement.name.name;
    if(!['WalletWheelControls','View'].includes(name))return false;
    const attributes=element.openingElement.attributes;
    const handler=parse('const item=<View onLayout={event=>{const measured=Math.round(event.nativeEvent.layout.width);if(Number.isFinite(measured)&&measured>0)setWalletViewportWidth(previous=>previous===measured?previous:measured);}}/>;').program.body[0].declarations[0].init.openingElement.attributes[0];
    const old=attributes.findIndex(item=>item.type==='JSXAttribute'&&item.name.name==='onLayout');
    if(old>=0)attributes[old]=handler;else attributes.push(handler);
    return true;
  };
  walk(main,node=>{
    if(node.type==='VariableDeclarator'&&node.id.name==='cardWidth'){node.init=parse('const size=Math.max(1,walletViewportWidth || width-40);').program.body[0].declarations[0].init;width++;}
    if(node.type==='VariableDeclarator'&&node.id.name==='wallet'){
      wallet++;
      if(node.init?.type!=='ArrowFunctionExpression')throw Error('지갑 화면 형식을 확인해주세요.');
      if(!attach(node.init.body)){
        const wrapper=parse('const item=<View style={{width:"100%"}}></View>;').program.body[0].declarations[0].init;
        attach(wrapper);wrapper.children=[node.init.body];node.init.body=wrapper;
      }
    }
  });
  if(width!==1||wallet!==1)throw Error('지갑 너비 연결 위치를 확인해주세요. 변경하지 않았습니다.');
}
const files=new Map();
for(const dir of ['screens','components']){
  for(const name of fs.readdirSync(path.join(root,dir)).filter(name=>name.endsWith('.js'))){
    const relative=dir+'/'+name,original=fs.readFileSync(path.join(root,relative),'utf8'),ast=parse(original),scope=path.basename(name,'.js');
    let changed=false;
    walk(ast,node=>{
      if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='StyleSheet'&&node.callee.property.name==='create'&&node.arguments[0]?.type==='ObjectExpression'){
        styleSheet(node.arguments[0],scope);changed=true;
      }
      if(node.type==='JSXAttribute'&&['style','contentContainerStyle'].includes(node.name.name)&&node.value?.expression?.type==='ObjectExpression'){soften(node.value.expression);changed=true;}
      if(scope==='MyDataCardStatus'&&node.type==='VariableDeclarator'&&['box','title','hint'].includes(node.id?.name)&&node.init?.type==='ObjectExpression'){
        merge(node.init,node.id.name==='box'?{backgroundColor:T.white,borderRadius:22,padding:20,gap:12,borderColor:T.line}:node.id.name==='title'?{fontSize:16,fontWeight:'800',color:T.ink}:{fontSize:13,lineHeight:22,color:T.muted});changed=true;
      }
      if(['MyDataScreen','MyDataLoadingScreen'].includes(scope)&&node.type==='JSXElement'&&node.openingElement.name.name==='ScrollView'){
        const attrs=node.openingElement.attributes;
        const body=attrs.find(item=>item.name?.name==='contentContainerStyle')?.value?.expression;
        if(body?.type==='ObjectExpression')merge(body,{...page(720),flexGrow:1,backgroundColor:T.bg});
        if(!attrs.some(item=>item.name?.name==='style'))attrs.push(parse('const item=<ScrollView style={{flex:1,backgroundColor:"#F4F7FB"}}/>;').program.body[0].declarations[0].init.openingElement.attributes[0]);
        changed=true;
      }
    });
    if(scope==='MainScreen'){mainLayout(ast);changed=true;}
    if(scope==='WalletWheelControls'){
      walk(ast,node=>{
        if(node.type==='FunctionDeclaration'&&node.id.name==='WalletWheelControls'){
          const props=node.params[0];if(props?.type!=='ObjectPattern')throw Error('지갑 컨트롤 속성을 확인해주세요.');
          if(!props.properties.some(item=>keyName(item)==='onLayout'))props.properties.push({type:'ObjectProperty',key:{type:'Identifier',name:'onLayout'},value:{type:'Identifier',name:'onLayout'},computed:false,shorthand:true});
        }
        if(node.type==='JSXElement'&&node.openingElement.name.name==='View'&&node.openingElement.attributes.some(item=>item.name?.name==='ref'&&item.value?.expression?.name==='root')){
          if(!node.openingElement.attributes.some(item=>item.name?.name==='onLayout'))node.openingElement.attributes.push(parse('const item=<View onLayout={onLayout}/>;').program.body[0].declarations[0].init.openingElement.attributes[0]);
        }
      });changed=true;
    }
    if(changed){const code=babel.transformFromAstSync(ast,original,{configFile:false,babelrc:false,comments:true}).code+'\n';parse(code);files.set(relative,code);}
  }
}
if(!files.has('screens/MainScreen.js'))throw Error('프로젝트 폴더를 확인해주세요.');
for(const [name,code] of files){
  const target=path.join(root,name),backup=target+'.before-ui-polish.bak';
  if(!fs.existsSync(backup))fs.copyFileSync(target,backup);
  fs.writeFileSync(target,code,'utf8');
}
console.log('완료: '+files.size+'개 화면·컴포넌트 UI 정리. App.js와 데이터 파일은 변경하지 않았습니다.');
console.log('백업: 각 파일의 .before-ui-polish.bak');
