import * as Store from './demoStore';
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
