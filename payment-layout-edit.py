from pathlib import Path
p=Path('screens/PaymentScreen.js')
s=p.read_text(encoding='utf-8-sig')
s=s.replace("import { DEMO_WALLET_CARDS } from '../data/cards';","import { CARD_CATALOG, DEMO_WALLET_CARDS } from '../data/cards';")
s=s.replace("const imageOf = card => card.image || CARD_PRODUCTS[catalogOf(card)?.code]?.image;", """const imageOf = card => card.image;
export function realProductCard(card) {
  if (!card || card.isOwned === false || card.isRecommendedOnly) return null;
  const catalog = catalogOf(card);
  const pdf = CARD_CATALOG[card.id];
  const image = catalog ? CARD_PRODUCTS[catalog.code]?.image : pdf?.image;
  if (!image || (!catalog && !pdf)) return null;
  return { ...card, name: catalog?.name || pdf.name,
    issuer: catalog?.issuer || '신한카드', type: catalog?.type || '체크',
    catalogCode: catalog?.code, image, realProduct: true };
}
export function realWalletCards(card, cards) {
  return Array.from(new Map([...(card ? [card] : []), ...cards]
    .map(realProductCard).filter(Boolean).map(item => [item.id, item])).values());
}""")
s=s.replace("const options = useMemo(() => Array.from(new Map([...(card ? [card] : []), ...cards].map(c => [c.id, c])).values()), [card, cards]);", "const options = useMemo(() => realWalletCards(card, cards), [card, cards]);")
s=s.replace("const [selectedId, setSelectedId] = useState(card?.id || options[0]?.id);", "const [selectedId, setSelectedId] = useState(options.find(c => c.id === card?.id)?.id || options[0]?.id);")
s=s.replace("  useEffect(() => { if (card?.id) setSelectedId(card.id); }, [card?.id]);", """  useEffect(() => {
    if (options.some(c => c.id === card?.id)) setSelectedId(card.id);
  }, [card?.id, options]);
  const notified = useRef(null);
  useEffect(() => {
    if (selected && selected.id !== card?.id && notified.current !== selected.id) {
      notified.current = selected.id;
      try { onSelectCard?.(selected.id); } catch (problem) { setError(problem.message); }
    }
  }, [selected?.id, card?.id, onSelectCard]);""")
start=s.index('      {!receipt && <View style={s.box}>')
end=s.index('      {receipt && <View style={s.box}>',start)
qr=s[start:end]
s=s[:start]+s[end:]
insert=s.index('      <View style={s.hero}>')
s=s[:insert]+qr+s[insert:]
s=s.replace('결제할 카드가 없습니다.', '등록된 실제 상품 카드가 없습니다.')
s=s.replace('<TouchableOpacity onPress={close}><Text style={s.link}>메인으로</Text>', '<Text style={s.hint}>기존 임의 상품은 제외했습니다. 카드 관리에서 실제 보유 상품을 등록해주세요.</Text><TouchableOpacity onPress={close}><Text style={s.link}>카드 등록하러 돌아가기</Text>')
s=s.replace('지갑에서 선택한 결제 카드','실제 상품 카드 · 카드사 원본 이미지')
s=s.replace("source ? '이미지를 불러오지 못했어요.' : '실제 상품 이미지가 없는 기존 시연 카드입니다.'", "'카드사 이미지를 불러오지 못했어요.'")
s=s.replace('결제 카드 선택</Text>', '실제 상품 카드 선택</Text>')
p.write_text(s,encoding='utf-8')
