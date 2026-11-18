from pathlib import Path, PurePosixPath
from collections import defaultdict, Counter
from datetime import datetime
import argparse, calendar, csv, io, json, re, shutil, zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--db', help='최종 DB 1년 ZIP 경로')
args = parser.parse_args()
if args.db:
    archive = Path(args.db)
else:
    candidates = list((Path.home() / 'Downloads').glob('최종_DB_1*.zip'))
    if len(candidates) != 1:
        raise SystemExit('python scripts/setup-mydata.py --db "DB ZIP 전체 경로" 로 실행해주세요.')
    archive = candidates[0]
z = zipfile.ZipFile(archive)
files = {PurePosixPath(n).name: n for n in z.namelist() if not n.startswith('__MACOSX/') and not n.endswith('/')}
def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(files[name]), encoding='utf-8-sig'))
def val(value): return value not in ('', None, '\\N')
def number(value): return int(float(value)) if val(value) else None
def keyed(name, field): return {r[field]: r for r in rows(name)}
required = ['cards.csv','categories.csv','benefits.csv','card_tiers.csv','benefit_tiers.csv',
            'benefit_groups.csv','benefit_group_tiers.csv','user_profiles.csv','user_cards.csv',
            'user_card_details.csv','payments.csv','card_month_status.csv']
if any(n not in files for n in required):
    raise SystemExit('최종_DB_1년 ZIP을 지정해주세요. csv (1).zip은 구조가 다릅니다.')
cards=keyed('cards.csv','card_id'); categories=keyed('categories.csv','category')
benefits=keyed('benefits.csv','benefit_id'); tiers=keyed('card_tiers.csv','tier_id')
groups=keyed('benefit_groups.csv','group_id')
benefit_tiers=list(rows('benefit_tiers.csv')); group_tiers=list(rows('benefit_group_tiers.csv'))
profiles={r['user_id']:r for r in rows('user_profiles.csv') if r['user_type']=='demo'}
owned={r['user_card_id']:r for r in rows('user_cards.csv') if r['user_id'] in profiles}
details=keyed('user_card_details.csv','user_card_id')
monthly={(r['user_card_id'],r['year_month']):r for r in rows('card_month_status.csv') if r['user_card_id'] in owned}
history=defaultdict(list); latest=''
for r in rows('payments.csv'):
    latest=max(latest,r['paid_at'])
    if r['user_card_id'] in owned: history[r['user_card_id']].append(r)
if not latest or not profiles: raise SystemExit('데모 사용자 또는 결제내역이 없습니다.')
at=datetime.strptime(latest,'%Y-%m-%d %H:%M:%S'); current=latest[:7]
end=datetime(at.year,at.month,1); start_index=at.year*12+at.month-1-6
start=datetime(start_index//12,start_index%12+1,1)
start_text=start.strftime('%Y-%m-%d'); end_text=end.strftime('%Y-%m-%d')
period_label=start.strftime('%Y.%m')+' ~ '+datetime(end.year if end.month>1 else end.year-1,end.month-1 if end.month>1 else 12,1).strftime('%Y.%m')
names={'OFFICE':'직장인','STUDENT':'대학생','HOME50':'50대 생활형','NIGHTOWL':'야근 직장인','REMOTE':'재택근무','FAMILY':'가족 생활형'}
snapshots={}
for uid,profile in profiles.items():
    user_cards=[]; analysis=[]
    for ucid,uc in owned.items():
        if uc['user_id']!=uid: continue
        c=cards[uc['card_id']]; status=monthly.get((ucid,current))
        if not status: raise ValueError('이번 달 실적 누락: '+ucid)
        txs=history[ucid]; this_month=[r for r in txs if r['paid_at'][:7]==current]
        analysis.extend(r for r in txs if start_text<=r['paid_at']<end_text)
        amount=sum(int(r['amount']) for r in this_month)
        if amount!=number(status['perf']): raise ValueError('DB 실적 불일치: '+ucid)
        tier_id=status['tier_id']; perf=number(status['perf']); previous=number(status['prev_perf'])
        thresholds=sorted({number(t['min_amount']) for t in tiers.values() if t['card_id']==c['card_id']})
        next_threshold=next((n for n in thresholds if n>perf),None)
        caps=[]
        def cap(label,limit,entries,unit='KRW',usage=False,known=True):
            if limit is None: return
            used=sum(int(t['amount'] if usage else t['benefit_amount']) for t in entries) if known else None
            caps.append({'label':label,'limit':limit,'used':min(limit,used) if used is not None else None,
                         'remaining':max(0,limit-used) if used is not None else None,
                         'unit':'USAGE_KRW' if usage else unit})
        active=[b for b in benefits.values() if b['card_id']==c['card_id']]
        kinds={b['benefit_kind'] for b in active}; units={'POINT' if k=='POINT' else 'KRW' for k in kinds}
        total_limit=number(tiers[tier_id]['total_limit']) if tier_id in tiers else None
        cap('카드 통합 한도',total_limit,this_month,next(iter(units)) if len(units)==1 else 'UNKNOWN',known=len(units)==1)
        for rule in benefit_tiers:
            b=benefits.get(rule['benefit_id'])
            if not b or b['card_id']!=c['card_id'] or rule['tier_id']!=tier_id: continue
            entries=[r for r in this_month if r['benefit_id']==b['benefit_id']]
            unit='POINT' if b['benefit_kind']=='POINT' else 'KRW'
            cap(b['benefit_name'],number(rule['monthly_limit']),entries,unit,b['limit_basis']=='USAGE')
            if val(rule['monthly_count']):
                count=number(rule['monthly_count']);used=len(entries)
                caps.append({'label':b['benefit_name']+' · 기록된 적용 횟수','limit':count,'used':min(count,used),'remaining':max(0,count-used),'unit':'COUNT'})
        for rule in group_tiers:
            g=groups.get(rule['group_id'])
            if not g or g['card_id']!=c['card_id'] or rule['tier_id']!=tier_id: continue
            ids={b['benefit_id'] for b in active if b['group_id']==g['group_id']}
            group_units={'POINT' if benefits[i]['benefit_kind']=='POINT' else 'KRW' for i in ids}
            cap(g['group_name']+' · 공유 한도',number(rule['monthly_limit']),[r for r in this_month if r['benefit_id'] in ids],next(iter(group_units)) if len(group_units)==1 else 'UNKNOWN',known=len(group_units)==1)
        user_cards.append({'id':'db-card-'+ucid,'databaseCardId':c['card_id'],'userCardId':ucid,
            'name':c['card_name'],'issuer':c['issuer'],'type':'신용' if c['card_type']=='CREDIT' else '체크',
            'number':'가상 보유 · •••• '+uc['card_last4'],'annualFee':number(c['annual_fee_domestic']),
            'description':c['description'],'order':number(details.get(ucid,{}).get('display_order')) or 0,
            'status':{'month':current,'currentSpend':perf,'previousSpend':previous,'nextThreshold':next_threshold,
                'remainingToNext':max(0,next_threshold-perf) if next_threshold is not None else 0,
                'progress':min(1,perf/next_threshold) if next_threshold else 1,'caps':caps}})
    analysis.sort(key=lambda r:(r['paid_at'],int(r['payment_id'])))
    total=sum(int(r['amount']) for r in analysis); by_cat=Counter(); by_hour=Counter(); by_day=Counter(); by_month=Counter()
    for r in analysis:
        amount=int(r['amount']);date=datetime.strptime(r['paid_at'],'%Y-%m-%d %H:%M:%S')
        by_cat[r['category']]+=amount;by_hour[date.hour]+=amount;by_day[date.weekday()]+=amount;by_month[r['paid_at'][:7]]+=amount
    def aggregate(items,label):return [{'label':label(k),'amount':v,'share':v/total if total else 0} for k,v in items]
    snapshots[uid]={'version':1,'userId':uid,'label':names.get(profile['persona_code'],profile['persona_code'])+' 데모 '+uid,
        'asOf':latest,'period':period_label,'start':start_text,'endExclusive':end_text,
        'coverageMonths':len(by_month),'transactionCount':len(analysis),'total':total,
        'cards':sorted(user_cards,key=lambda c:c['order']),
        'topCategories':aggregate(by_cat.most_common(3),lambda k:categories[k]['category_name']),
        'topHours':aggregate(by_hour.most_common(3),lambda k:str(k)+'시'),
        'weekdays':aggregate([(i,by_day[i]) for i in range(7)],lambda k:'월화수목금토일'[k]+'요일'),
        'months':aggregate(sorted(by_month.items()),lambda k:k),
        'transactions':[{'id':r['payment_id'],'cardId':'db-card-'+r['user_card_id'],'merchant':r['merchant_name'],
            'category':categories[r['category']]['category_name'],'amount':int(r['amount']),'date':r['paid_at']}
            for r in analysis]}

SERVICE = r'''import * as Store from './demoStore';
import fixtures from '../data/myDataFixture.json';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
export const MYDATA_KEY = 'solpay_mydata_import_v1';
export const DEMO_USERS = Object.values(fixtures).map(s => ({id:s.userId,label:s.label}));
const listeners=new Set(); let snapshot=null, restored=false, queue=Promise.resolve();
const normalize=v=>String(v||'').toUpperCase().replace(/신한카드|KB국민카드|KB국민|NH농협카드|하나카드|롯데카드|BC카드|신한|카드|신용|체크|[\s()·]/g,'');
function hydrate(id){
 const raw=fixtures[id];if(!raw)throw Error('선택한 데모 사용자 데이터가 없습니다.');
 return {...raw,cards:raw.cards.map(c=>{
  const matches=CSV_CARD_CATALOG.filter(old=>normalize(old.name)===normalize(c.name)&&old.type===c.type);
  const code=matches.length===1?matches[0].code:null;
  return {...c,catalogCode:code,image:code?CARD_PRODUCTS[code]?.image:undefined,
   color:c.issuer.includes('KB')?'#FFCA4B':'#1459F5',textColor:c.issuer.includes('KB')?'#263041':'#FFFFFF',
   isOwned:true,isDemoOwned:true,isImportedMyData:true,isManuallyRegistered:false,
   category:'가상 마이데이터 자동 등록',reason:'선택한 데모 사용자의 DB 보유 카드입니다. 실제 금융기관 조회가 아닙니다.'};
 })};
}
const emit=()=>listeners.forEach(fn=>fn(snapshot));
const enqueue=fn=>{const job=queue.catch(()=>{}).then(fn);queue=job;return job;};
export async function waitForMyDataWrites(){await queue.catch(()=>{});}
export const getMyDataSnapshot=()=>snapshot;
export function subscribeMyData(fn){listeners.add(fn);return()=>listeners.delete(fn);}
export function clearMyDataMemory(){snapshot=null;restored=false;emit();}
export function restoreMyData(){return enqueue(async()=>{
 if(restored)return snapshot;const raw=await Store.getItemAsync(MYDATA_KEY);
 if(raw){const value=JSON.parse(raw);if(value.version!==1)throw Error('불러오기 기록을 다시 생성해주세요.');snapshot=hydrate(String(value.userId));}
 else snapshot=null;restored=true;emit();return snapshot;
});}
const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
export function importMyData(userId,onStep=()=>{},{isCancelled=()=>false}={}){
 return enqueue(async()=>{
  const check=()=>{if(isCancelled())throw Error('불러오기가 취소되었습니다.');};
  check();onStep(0);await yieldFrame();check();const next=hydrate(String(userId));
  if(!next.cards.length)throw Error('보유 카드 목록이 없습니다.');
  onStep(1);await yieldFrame();check();
  if(next.transactionCount!==next.transactions.length)throw Error('결제내역 건수가 일치하지 않습니다.');
  onStep(2);await yieldFrame();check();
  if(next.cards.some(c=>!c.status))throw Error('카드 실적 정보가 누락되었습니다.');
  await Store.setItemAsync(MYDATA_KEY,JSON.stringify({version:1,userId:String(userId)}));
  snapshot=next;restored=true;emit();onStep(3);return next;
 });
}
export function mergeImportedWallet(existing,data=snapshot){
 if(!data)return existing;
 const names=new Set(data.cards.map(c=>normalize(c.name)+c.type));
 return [...data.cards,...existing.filter(c=>c.isManuallyRegistered&&!c.isImportedMyData&&!names.has(normalize(c.name)+c.type))];
}
export function findImportedCard(card,data=snapshot){
 if(!data||!card)return null;
 return data.cards.find(c=>c.id===card.id||
  (c.catalogCode&&c.catalogCode===(card.catalogCode||card.code))||
  (normalize(c.name)===normalize(card.name)&&(!card.type||card.type===c.type)))||null;
}
'''

PANEL = r'''import React,{useEffect,useState} from 'react';
import {Text,View,TouchableOpacity} from 'react-native';
import {getMyDataSnapshot,subscribeMyData,restoreMyData,findImportedCard} from '../utils/myDataService';
export {mergeImportedWallet} from '../utils/myDataService';
export const money=n=>Number(n||0).toLocaleString('ko-KR')+'원';
export function useMyDataSnapshot(){
 const [snapshot,setSnapshot]=useState(getMyDataSnapshot),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let alive=true;const off=subscribeMyData(value=>{if(alive)setSnapshot(value);});
  restoreMyData().then(value=>{if(alive)setSnapshot(value);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;off();};},[]);
 return {snapshot,error,loading};
}
export const box={backgroundColor:'#FFF',borderRadius:15,padding:17,marginVertical:8,gap:9,borderWidth:1,borderColor:'#E2E9F3'};
export const title={fontSize:15,fontWeight:'800',color:'#233D62'};
export const hint={fontSize:12,lineHeight:21,color:'#71819B'};
const reward=(n,unit)=>n==null?'확인 필요':Number(n).toLocaleString('ko-KR')+(unit==='POINT'?'P':unit==='COUNT'?'회':unit==='UNKNOWN'?' (단위 확인 필요)':'원');
export default function MyDataCardStatus({card,expanded=false}){
 const {snapshot,error,loading}=useMyDataSnapshot();const [show,setShow]=useState(expanded);
 const imported=findImportedCard(card,snapshot);
 if(!imported)return error?<Text style={hint}>{error}</Text>:null;
 const s=imported.status;
 return <View style={box}><Text style={title}>가상 마이데이터 · {imported.name}</Text>
  <Text style={hint}>{snapshot.label} · 기준 {snapshot.asOf} KST</Text>
  <Text style={title}>{s.month} 누적 사용액 {money(s.currentSpend)}</Text>
  <Text style={hint}>전월 실적 {money(s.previousSpend)} · 이번 달은 일부 기간입니다.</Text>
  <View accessible accessibilityLabel={'실적 진행 '+Math.round(s.progress*100)+'퍼센트'} style={{height:8,backgroundColor:'#E6EDF8',borderRadius:5,overflow:'hidden'}}><View style={{height:8,width:(s.progress*100)+'%',backgroundColor:'#245DE5'}}/></View>
  <Text style={hint}>{s.nextThreshold!=null?'다음 실적 구간 '+money(s.nextThreshold)+'까지 '+money(s.remainingToNext):'등록된 실적 구간의 최고 기준에 도달했거나 추가 구간이 없습니다.'}</Text>
  <TouchableOpacity accessibilityRole="button" onPress={()=>setShow(!show)} style={{paddingVertical:10}}><Text style={{color:'#245DE5',fontWeight:'700'}}>{show?'한도 현황 접기':'할인·적립 한도 현황 보기'}</Text></TouchableOpacity>
  {show&&(s.caps.length?s.caps.map((c,i)=><View key={i} style={{paddingVertical:8,borderTopWidth:1,borderColor:'#EDF1F7',gap:4}}><Text style={title}>{c.label}</Text>
   <Text style={hint}>{c.unit==='USAGE_KRW'?'혜택 대상 결제금액 한도 · ':''}사용 {reward(c.used,c.unit)} / 한도 {reward(c.limit,c.unit)} · 남음 {reward(c.remaining,c.unit)}</Text>
   {c.unit==='UNKNOWN'&&<Text style={hint}>원화·포인트가 혼합되어 통합 잔여 한도를 임의로 계산하지 않았습니다.</Text>}</View>):<Text style={hint}>현재 실적 구간에 등록된 월 한도 조건이 없습니다.</Text>)}
  <Text style={hint}>DB에 기록된 혜택 적용 내역 기준입니다. 원화·포인트·혜택 대상 사용액 한도를 구분하며, 프로모션은 기본 한도에서 제외합니다. 금융사 확정 실적이 아닙니다.</Text>
 </View>;
}
'''

LOADING = r'''import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,ScrollView,Text,TouchableOpacity,View} from 'react-native';
import {DEMO_USERS,importMyData,getMyDataSnapshot} from '../utils/myDataService';
import {box,title,hint} from '../components/MyDataCardStatus';
const STEPS=['보유 카드 목록 불러오기·자동 등록','최근 6개월 결제내역 불러오기','카드별 실적·한도 현황 준비'];
const button={padding:16,backgroundColor:'#245DE5',borderRadius:12,alignItems:'center',marginVertical:5};
export default function MyDataLoadingScreen({onNext,userId}){
 const [selected,setSelected]=useState(String(userId||getMyDataSnapshot()?.userId||DEMO_USERS[0]?.id||'1'));
 const [step,setStep]=useState(-1),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[result,setResult]=useState(null);
 const active=useRef(true),request=useRef(0),lock=useRef(false);
 const run=async id=>{if(lock.current)return;lock.current=true;setBusy(true);setStep(0);setFailure('');setResult(null);const ticket=++request.current;
  try{const data=await importMyData(id,value=>{if(active.current&&request.current===ticket)setStep(value);},{isCancelled:()=>!active.current||request.current!==ticket});if(active.current&&request.current===ticket)setResult(data);}
  catch(e){if(active.current&&request.current===ticket)setFailure(e.message);}
  finally{if(request.current===ticket){lock.current=false;if(active.current)setBusy(false);}}};
 useEffect(()=>{active.current=true;run(selected);return()=>{active.current=false;request.current+=1;lock.current=false;};},[]);
 return <ScrollView contentContainerStyle={{padding:24,gap:16,flexGrow:1,backgroundColor:'#F5F7FC'}}>
  <Text style={{...title,fontSize:25}}>가상 마이데이터 불러오기</Text>
  <Text style={hint}>실제 금융기관에 연결하지 않습니다. 선택한 데모 사용자의 DB 데이터만 불러옵니다. 로그인 계정 자동 연결은 이후 통합합니다.</Text>
  <View style={box}><Text style={title}>체험할 사용자</Text>{DEMO_USERS.map(u=><TouchableOpacity key={u.id} accessibilityRole="radio" accessibilityState={{checked:selected===u.id}} disabled={busy} onPress={()=>{setSelected(u.id);setResult(null);setStep(-1);setFailure('');}} style={{padding:12,backgroundColor:selected===u.id?'#EAF1FF':'#F7F9FC',borderRadius:10}}><Text style={title}>{selected===u.id?'● ':'○ '}{u.label}</Text></TouchableOpacity>)}</View>
  <View style={box}>{STEPS.map((label,i)=><Text key={label} style={{...hint,color:step>i?'#168264':'#536B8F'}}>{step>i?'✓ ':busy&&step===i?'● ':'○ '}{label}</Text>)}{busy&&<ActivityIndicator color="#245DE5"/>}</View>
  {!!failure&&<View accessibilityRole="alert" style={box}><Text style={{color:'#B4374B'}}>{failure}</Text><Text style={hint}>기존 데이터는 불러오기 저장이 성공하기 전까지 유지됩니다.</Text></View>}
  {!busy&&!result&&<TouchableOpacity accessibilityRole="button" style={button} onPress={()=>run(selected)}><Text style={{color:'#FFF',fontWeight:'800'}}>{failure?'다시 시도':'선택한 사용자 불러오기'}</Text></TouchableOpacity>}
  {result&&<View style={box}><Text style={title}>불러오기 완료</Text><Text style={hint}>보유 카드 {result.cards.length}장 · 결제 {result.transactionCount.toLocaleString('ko-KR')}건</Text><Text style={hint}>소비 분석 {result.period} · 실적 기준 {result.asOf} KST</Text>
   <TouchableOpacity accessibilityRole="button" style={button} onPress={async()=>{try{if(typeof onNext!=='function')throw Error('분석 결과 화면 연결을 확인해주세요.');await onNext(result);}catch(e){setFailure(e.message);}}}><Text style={{color:'#FFF',fontWeight:'800'}}>소비 분석 결과 보기</Text></TouchableOpacity></View>}
 </ScrollView>;
}
'''

RESULT = r'''import React from 'react';
import {ActivityIndicator,ScrollView,Text,TouchableOpacity,View} from 'react-native';
import MyDataCardStatus,{useMyDataSnapshot,box,title,hint,money} from '../components/MyDataCardStatus';
function Bars({rows}){return rows.map((r,i)=><View key={i} style={{gap:5,marginVertical:7}}><Text style={hint}>{r.label} · {money(r.amount)} · {(r.share*100).toFixed(1)}%</Text><View style={{height:9,borderRadius:5,backgroundColor:'#EDF1F7',overflow:'hidden'}}><View style={{height:9,width:Math.min(100,r.share*100)+'%',backgroundColor:'#245DE5'}}/></View></View>);}
export default function MyDataScreen({onNext}){
 const {snapshot:s,error,loading}=useMyDataSnapshot();
 return <ScrollView contentContainerStyle={{padding:24,paddingBottom:60,gap:16,backgroundColor:'#F5F7FC',flexGrow:1}}>
  <Text style={{...title,fontSize:25}}>마이데이터 소비 분석</Text>
  {loading&&<ActivityIndicator color="#245DE5"/>}
  {!!error&&<Text style={{color:'#B4374B'}}>{error}</Text>}
  {!loading&&!s&&<Text style={hint}>불러온 데이터가 없습니다. 개발자 메뉴의 마이데이터 불러오기 화면에서 먼저 데이터를 준비해주세요.</Text>}
  {s&&<><View style={box}><Text style={title}>{s.label}</Text><Text style={{...title,fontSize:28}}>{money(s.total)}</Text><Text style={hint}>{s.period} · {s.transactionCount.toLocaleString('ko-KR')}건 · 자료가 있는 달 {s.coverageMonths}/6개월</Text><Text style={hint}>업종·시간·요일 비중은 모두 이 기간의 결제 금액 기준입니다. 한국 시간으로 분석했습니다. 실제 지출·절약액이 아닌 가상 데이터입니다.</Text></View>
   <View style={box}><Text style={title}>소비 업종 상위 3개</Text><Bars rows={s.topCategories}/></View>
   <View style={box}><Text style={title}>주요 소비 시간대</Text><Bars rows={s.topHours}/></View>
   <View style={box}><Text style={title}>요일별 소비 비중</Text><Bars rows={s.weekdays}/></View>
   <View style={box}><Text style={title}>월별 소비 금액</Text><Bars rows={s.months}/></View>
   <Text style={title}>자동 등록된 보유 카드 {s.cards.length}장</Text>
   {s.cards.map(c=><MyDataCardStatus key={c.id} card={c} expanded/>)}
   <Text style={hint}>소비 요약은 완료된 6개월, 카드 실적은 {s.asOf}까지의 DB 기록입니다. 현재 달은 일부 기간입니다.</Text>
  </>}
  <TouchableOpacity accessibilityRole="button" disabled={!s||loading} style={{padding:16,backgroundColor:s?'#245DE5':'#AAB8D0',borderRadius:12,alignItems:'center'}} onPress={()=>onNext?.()}><Text style={{color:'#FFF',fontWeight:'800'}}>다음 단계로</Text></TouchableOpacity>
 </ScrollView>;
}
'''

main_path=ROOT/'screens/MainScreen.js'; wallet_path=ROOT/'utils/wallet.js'; privacy_path=ROOT/'utils/privacyData.js'
main=main_path.read_text(encoding='utf-8'); wallet=wallet_path.read_text(encoding='utf-8'); privacy=privacy_path.read_text(encoding='utf-8')
if 'MYDATA_UI_LINK_V1' not in main:
    hook='  const { width } = useWindowDimensions();'
    home="{tab === 'home' && renderHome()}"
    if main.count(hook)!=1 or main.count(home)!=1: raise SystemExit('MainScreen 구조가 달라 자동 연결을 중단했습니다. 기존 파일은 변경하지 않았습니다.')
    main="import MyDataCardStatus, {useMyDataSnapshot, mergeImportedWallet} from '../components/MyDataCardStatus';\n"+main
    main=main.replace(hook,'''  // MYDATA_UI_LINK_V1
  const {snapshot: importedMyData} = useMyDataSnapshot();
  const [importedSelection, setImportedSelection] = useState(null);
  const suppliedCards = walletCards;
  const suppliedActive = activeCardId;
  const suppliedSelect = onSelectCard;
  useEffect(() => { setImportedSelection(null); }, [suppliedActive, importedMyData?.userId]);
  walletCards = mergeImportedWallet(walletCards, importedMyData);
  activeCardId = walletCards.some(c => c.id === importedSelection) ? importedSelection
    : walletCards.some(c => c.id === suppliedActive) ? suppliedActive : walletCards[0]?.id;
  onSelectCard = id => {
    if (!walletCards.some(c => c.id === id)) return;
    setImportedSelection(id);
    if (suppliedCards.some(c => c.id === id)) suppliedSelect(id);
  };
'''+hook)
    main=main.replace(home,"{tab === 'home' && <><MyDataCardStatus card={currentCard}/>{renderHome()}</>}")
    pattern=r'(\{selectedCatalog\.description\}\s*</Text>)'
    if len(re.findall(pattern,main))!=1: raise SystemExit('카드 상세 위치가 달라 연결을 중단했습니다. 기존 파일은 변경하지 않았습니다.')
    main=re.sub(pattern,r'\1\n                  <MyDataCardStatus card={selectedCatalog} expanded/>',main)
if 'MYDATA_WALLET_LINK_V1' not in wallet:
    old='''  return [
    ...registered,
    ...DEMO_WALLET_CARDS.filter(card => !ids.has(card.id)),
  ];'''
    if old not in wallet or wallet.count('  const preferences = await readPreferences();')!=1:
        raise SystemExit('wallet.js 구조가 달라 연결을 중단했습니다. 기존 파일은 변경하지 않았습니다.')
    wallet="// MYDATA_WALLET_LINK_V1\nimport {mergeImportedWallet, getMyDataSnapshot, restoreMyData} from './myDataService';\n"+wallet
    wallet=wallet.replace(old,'''  return mergeImportedWallet([
    ...registered,
    ...DEMO_WALLET_CARDS.filter(card => !ids.has(card.id)),
  ], getMyDataSnapshot());''')
    wallet=wallet.replace('  const preferences = await readPreferences();','  await restoreMyData();\n  const preferences = await readPreferences();')
if 'MYDATA_DELETE_LINK_V1' not in privacy:
    if 'const PERSONAL = [' not in privacy or '  return {\n    ok:' not in privacy:
        raise SystemExit('privacyData.js 구조가 달라 연결을 중단했습니다. 기존 파일은 변경하지 않았습니다.')
    privacy="// MYDATA_DELETE_LINK_V1\nimport {clearMyDataMemory, waitForMyDataWrites} from './myDataService';\n"+privacy
    privacy=privacy.replace('  const targets =', '  await waitForMyDataWrites();\n  const targets =')
    privacy=privacy.replace('const PERSONAL = [',"const PERSONAL = [\n  ['solpay_mydata_import_v1', '마이데이터 불러오기'],")
    privacy=privacy.replace('  return {\n    ok:',"  if (!failed.includes('마이데이터 불러오기')) clearMyDataMemory();\n\n  return {\n    ok:")

outputs={ROOT/'data/myDataFixture.json':json.dumps(snapshots,ensure_ascii=False,separators=(',',':')),
 ROOT/'utils/myDataService.js':SERVICE, ROOT/'components/MyDataCardStatus.js':PANEL,
 ROOT/'screens/MyDataLoadingScreen.js':LOADING,ROOT/'screens/MyDataScreen.js':RESULT,
 main_path:main,wallet_path:wallet,privacy_path:privacy}
for target,content in outputs.items():
    target.parent.mkdir(parents=True,exist_ok=True)
    backup=target.with_name(target.name+'.before-mydata.bak')
    if target.exists() and not backup.exists(): shutil.copy2(target,backup)
    target.write_text(content,encoding='utf-8')
print('완료: 데모 '+str(len(snapshots))+'명 / 소비 분석 '+period_label+' / 실적 기준 '+latest+' KST')
print('생성: 불러오기·결과 화면, 실적·한도 패널, 사용자별 가상 JSON')
print('연결: 메인 지갑·카드 상세, 지갑 읽기, 회원 탈퇴 데이터 삭제')
print('App.js는 변경하지 않았습니다. 첫 로그인 동의 직후 이동은 최종 App.js 통합 때 연결합니다.')
