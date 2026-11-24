import React, { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SERVER_MODE, api } from '../utils/api';
import { chatHistory } from '../utils/aiPlacementCore';
import { chatBlockViews } from '../utils/chatBlocks';
import { serverCardLinks } from '../utils/serverCards';
import ChatBlocks from './ChatBlocks';
import { addScheduleFromChat, deleteRulesFromChat } from '../utils/chatActions';

const avatar = require('../assets/chatbot-avatar.png');
const prompts = ['왜 이 카드예요?', '혜택 적용 조건', '다른 카드와 비교'];
const won = value => value.toLocaleString('ko-KR') + '원';

function answerQuestion(question, { selected, baseline, difference }) {
  if (/조건|실적|한도|가맹점|횟수|대상/.test(question)) {
    return {
      text: selected.benefit.reason || '이 거래에 적용되는 혜택 조건이에요.',
      detail: selected.benefit.condition || '등록된 상품 정보에서 자세한 조건을 확인할 수 없어요.',
    };
  }
  if (!/추천|비교|왜|차이|절약|혜택|할인|적립|캐시백/.test(question)) {
    return { text: '현재 거래의 카드 혜택, 적용 조건, 비교 결과를 알려드릴 수 있어요.' };
  }
  const sameCard = selected.id === baseline.id;
  const rows = sameCard ? [selected] : [selected, baseline];
  if (sameCard) {
    return {
      text: '비교할 다른 카드가 있으면 이 거래에서의 혜택 차이를 알려드릴게요. 카드 탭에서 카드를 더 등록해보세요.',
      rows,
    };
  }

  let text;
  if (difference === null) {
    text = '두 카드의 원화 혜택이 확인되면 차이를 계산할 수 있어요.';
  } else if (difference === 0) {
    text = '같은 거래에서 두 카드의 예상 혜택이 같아요.';
  } else {
    const better = difference > 0 ? selected : baseline;
    text = '같은 거래라면 ' + better.name + '의 예상 혜택이 ' + won(Math.abs(difference)) + ' 더 커요.';
  }
  return { text, rows };
}

export default function PaymentBenefitChat({ transaction, selected, baseline, difference, recommendationId = null, onSelectCard = null }) {
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const scroll = useRef(null);
  const mounted = useRef(true);
  const counter = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = (id, change) => setMessages(previous => previous.map(message => (message.id === id ? { ...message, ...change } : message)));

  // 서버 모드에서는 AI 챗봇(/api/ai/chat)에 묻고, 실패하면 앱 안의 기본 안내로 답한다.
  const ask = value => {
    const question = value.trim();
    if (!question || busy) return;
    setInput('');
    const local = () => answerQuestion(question, { selected, baseline, difference });
    const id = ++counter.current;
    if (!SERVER_MODE) {
      setMessages(previous => [...previous, { id, question, ...local() }]);
      return;
    }
    const history = chatHistory(messagesRef.current);
    setBusy(true);
    setMessages(previous => [...previous, { id, question, pending: true, text: '답변을 준비하고 있어요…' }]);
    // blocks: true → 앱이 답 아래에 표를 그린다 (AI 는 문장에서 카드별 금액 나열을 줄인다, 2026-11-24)
    api.aiChat({ message: question, history, screen: { name: 'pay', recommendation_id: recommendationId, blocks: true } })
      .then(data => {
        if (!data?.reply) return { ...local(), offline: true };
        const draft = data.rule_draft?.draft_id != null
          ? { id: data.rule_draft.draft_id, summary: data.rule_draft.summary || '', state: 'pending' }
          : null;
        return { text: data.reply, ai: true, draft, blocks: data.blocks };
      })
      .catch(() => ({ ...local(), offline: true }))
      .then(answer => {
        if (!mounted.current) return;
        update(id, { pending: false, ...answer });
        setBusy(false);
      });
  };

  // 챗봇이 만든 규칙 초안을 저장하거나 버린다.
  const decide = (message, action) => {
    update(message.id, { draft: { ...message.draft, state: 'working' } });
    (action === 'confirm' ? api.aiConfirmRuleDraft(message.draft.id) : api.aiCancelRuleDraft(message.draft.id))
      .then(() => action === 'confirm' ? 'saved' : 'cancelled')
      .catch(() => 'error')
      .then(state => {
        if (mounted.current) update(message.id, { draft: { ...message.draft, state } });
      });
  };

  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="결제 혜택 챗봇 열기" onPress={() => setVisible(true)} style={s.launcher}>
      <Image source={avatar} resizeMode="contain" style={s.face} />
    </Pressable>

    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => setVisible(false)} />
        <View accessibilityViewIsModal style={s.sheet}>
          <View style={s.header}>
            <View style={s.avatar}><Image source={avatar} resizeMode="contain" style={s.face} /></View>
            <Text accessibilityRole="header" style={s.heading}>SOL Pay 도우미</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="챗봇 닫기" onPress={() => setVisible(false)} style={s.iconButton}>
              <Ionicons name="close" size={24} color="#142D4E" />
            </Pressable>
          </View>
          <Text style={s.context}>{transaction}</Text>

          <ScrollView
            ref={scroll}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
            style={s.messages}
            contentContainerStyle={s.messageContent}
          >
            {!messages.length && <Text style={s.hint}>지금 거래에서 어떤 혜택을 받을 수 있는지 물어보세요.</Text>}
            {messages.map(message => <View key={message.id} style={s.exchange}>
              <Text style={s.question}>{message.question}</Text>
              <View style={s.answer} accessibilityLiveRegion="polite">
                <Text style={s.answerText}>{message.text}</Text>
                {!!message.blocks && <ChatBlocks
                  views={chatBlockViews(message.blocks, serverCardLinks())}
                  payLabel="이 카드로 결제 카드 바꾸기"
                  onPay={onSelectCard ? walletId => { onSelectCard(walletId); setVisible(false); } : null}
                  onAddSchedule={addScheduleFromChat}
                  onDeleteRules={deleteRulesFromChat}
                />}
                {!!message.detail && <Text style={s.hint}>{message.detail}</Text>}
                {message.rows?.map(row => <View key={row.id} style={s.row}>
                  <View style={s.rowCard}>
                    <Text style={s.answerText}>{row.name}</Text>
                    {!Number.isFinite(row.benefit.value) && !!row.benefit.reason && <Text style={s.hint}>{row.benefit.reason}</Text>}
                  </View>
                  <Text style={[s.amount, s.rowAmount]}>{row.reward}</Text>
                </View>)}
                {!!message.rows && <Text style={s.hint}>입력한 결제 조건으로 계산한 예상 혜택이에요.</Text>}
                {!!message.offline && <Text style={s.hint}>AI 챗봇에 연결하지 못해 기본 안내로 답했어요.</Text>}
                {!!message.draft && <View style={s.draft}>
                  {!!message.draft.summary && <Text style={s.answerText}>{message.draft.summary}</Text>}
                  {(message.draft.state === 'pending' || message.draft.state === 'error') && <View style={s.draftButtons}>
                    <Pressable accessibilityRole="button" onPress={() => decide(message, 'confirm')} style={s.draftSave}>
                      <Text style={s.draftSaveText}>저장</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => decide(message, 'cancel')} style={s.prompt}>
                      <Text style={s.amount}>취소</Text>
                    </Pressable>
                  </View>}
                  {message.draft.state === 'working' && <Text style={s.hint}>처리하고 있어요…</Text>}
                  {message.draft.state === 'saved' && <Text style={s.hint}>저장했어요. 다음 결제 화면부터 적용돼요.</Text>}
                  {message.draft.state === 'cancelled' && <Text style={s.hint}>저장하지 않았어요.</Text>}
                  {message.draft.state === 'error' && <Text style={s.hint}>처리하지 못했어요. 다시 눌러 주세요.</Text>}
                </View>}
              </View>
            </View>)}
          </ScrollView>

          <View style={s.prompts}>
            {prompts.map(question => <Pressable key={question} accessibilityRole="button" onPress={() => ask(question)} style={s.prompt}>
              <Text style={s.amount}>{question}</Text>
            </Pressable>)}
          </View>
          <View style={s.composer}>
            <TextInput
              accessibilityLabel="카드 혜택 질문"
              placeholder="카드 혜택을 물어보세요"
              placeholderTextColor="#596A83"
              returnKeyType="send"
              value={input}
              maxLength={240}
              onChangeText={setInput}
              onSubmitEditing={() => ask(input)}
              style={s.input}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="질문 보내기" onPress={() => ask(input)} disabled={!input.trim() || busy} style={[s.send, (!input.trim() || busy) && s.sendDisabled]}>
              <Ionicons name="send" size={19} color="#FFF" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

const s = StyleSheet.create({
  launcher: { position: 'absolute', bottom: __DEV__ || Platform.OS === 'web' ? 58 : 16, right: 16, width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D7E3F7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  face: { width: 91, height: 51 },
  avatar: { width: 47, height: 47, borderRadius: 24, backgroundColor: '#EEF4FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: '#1024488C' },
  sheet: { width: '100%', maxWidth: 560, height: '82%', maxHeight: 720, padding: 16, paddingBottom: 22, gap: 12, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flex: 1, fontSize: 21, fontWeight: '800', color: '#142D4E' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  context: { padding: 12, borderRadius: 12, backgroundColor: '#E8F1FF', color: '#15396C', fontWeight: '700' },
  messages: { flex: 1 },
  messageContent: { gap: 14, paddingVertical: 4 },
  exchange: { gap: 8 },
  question: { alignSelf: 'flex-end', maxWidth: '92%', padding: 11, borderRadius: 15, backgroundColor: '#1756DF', color: '#FFF', fontWeight: '700' },
  answer: { alignSelf: 'flex-start', backgroundColor: '#EDF3FF', padding: 12, borderRadius: 15, gap: 8, width: '100%' },
  answerText: { fontSize: 14, fontWeight: '700', color: '#142D4E', lineHeight: 21 },
  hint: { fontSize: 12, lineHeight: 19, color: '#536581' },
  row: { backgroundColor: '#FFF', borderRadius: 10, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowCard: { flex: 1, minWidth: 0, gap: 3 },
  amount: { color: '#164EBE', fontSize: 13, fontWeight: '800' },
  rowAmount: { maxWidth: '42%', textAlign: 'right' },
  prompts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  prompt: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, borderColor: '#BCD3FB', backgroundColor: '#F2F7FF' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 5, borderWidth: 1, borderColor: '#CED9EB', borderRadius: 14 },
  input: { flex: 1, minWidth: 0, paddingHorizontal: 8, minHeight: 42, color: '#142D4E', fontSize: 15 },
  send: { width: 42, height: 42, backgroundColor: '#1756DF', alignItems: 'center', justifyContent: 'center', borderRadius: 21 },
  sendDisabled: { opacity: 0.5 },
  draft: { backgroundColor: '#FFF', borderRadius: 10, padding: 10, gap: 8 },
  draftButtons: { flexDirection: 'row', gap: 6 },
  draftSave: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#1756DF' },
  draftSaveText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});
