const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const target = path.resolve(__dirname, '../screens/RoutineRecommendationScreen.js');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const marker = 'CARD_PICKER_FIXED_FOOTER_V1';
if (source.includes(marker)) {
  console.log('이미 적용되어 있습니다. App.js는 변경하지 않습니다.');
  process.exit(0);
}
function replaceOnce(before, after) {
  if (source.split(before).length !== 2) {
    throw Error('화면 구조가 달라 수정하지 않았습니다. 찾을 위치: ' + before.slice(0, 70));
  }
  source = source.replace(before, after);
}

replaceOnce(
  '  ActivityIndicator, AppState, Image, Linking, Modal,',
  '  ActivityIndicator, AppState, Image, Linking, Modal, KeyboardAvoidingView, Platform,'
);

replaceOnce(
`  const modal = (visible, close, children) => visible ? (
    <>
      {children}
      <TouchableOpacity
        disabled={busy}
        style={styles.secondary}
        onPress={close}
      >
        <Text style={styles.blue}>닫기</Text>
      </TouchableOpacity>
    </>
  ) : null;`,
`  const modal = (visible, close, children, showClose = true) => visible ? (
    <>
      {children}
      {showClose && (
        <TouchableOpacity disabled={busy} style={styles.secondary} onPress={close}>
          <Text style={styles.blue}>닫기</Text>
        </TouchableOpacity>
      )}
    </>
  ) : null;`
);

replaceOnce(
`        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.body}
            >`,
`        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.sheet, picker && styles.pickerFixedSheet]}>
            <ScrollView
              style={picker ? styles.pickerFixedScroll : undefined}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.body}
            >`
);

replaceOnce(
`                  <TouchableOpacity
                    disabled={disabled}
                    style={styles.primary}
                    onPress={save}
                  >
                    <Text style={styles.white}>보유 목록·입력값 저장</Text>
                  </TouchableOpacity>
                </>
              ))}`,
`                </>
              ), false)}`
);

replaceOnce(
`            </ScrollView>
          </View>
        </View>
      </Modal>`,
`            </ScrollView>
            {picker && (
              <View style={styles.pickerFixedFooter}>
                <Text style={styles.hint}>
                  선택한 보유 카드 {preferences.owned.length}종
                  {dirty ? ' · 변경사항 저장 필요' : ' · 저장된 설정'}
                </Text>
                {!!message && (
                  <Text style={styles.message} accessibilityLiveRegion="polite" numberOfLines={3}>
                    {message}
                  </Text>
                )}
                <View style={styles.pickerFixedActions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={busy}
                    style={[styles.secondary, styles.pickerFixedButton, busy && styles.pickerFixedDisabled]}
                    onPress={() => setPicker(false)}
                  >
                    <Text style={styles.blue}>닫기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={disabled}
                    style={[styles.primary, styles.pickerFixedButton, disabled && styles.pickerFixedDisabled]}
                    onPress={() => perform(async () => {
                      await persist();
                      setPicker(false);
                      setMessage('보유 카드와 입력값을 저장했습니다.');
                    })}
                  >
                    {busy ? <ActivityIndicator color="#FFF" /> : (
                      <Text style={styles.white}>저장 및 나가기</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>`
);

replaceOnce(
  'const styles = StyleSheet.create({',
`// ${marker}
const styles = StyleSheet.create({
  pickerFixedSheet: { height: '92%', minHeight: 0, overflow: 'hidden' },
  pickerFixedScroll: { flex: 1, minHeight: 0 },
  pickerFixedFooter: {
    flexShrink: 0, backgroundColor: '#FFF', padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    borderTopWidth: 1, borderTopColor: '#DCE5F2', gap: 9,
  },
  pickerFixedActions: { flexDirection: 'row', gap: 10 },
  pickerFixedButton: { flex: 1, minHeight: 48, justifyContent: 'center' },
  pickerFixedDisabled: { opacity: 0.5 },`
);

// 모든 위치 확인과 문법 검사에 성공한 경우에만 파일에 반영합니다.
babel.parseSync(source, {
  configFile: false,
  babelrc: false,
  parserOpts: { plugins: ['jsx'] },
});
const backup = target + '.before-fixed-footer.bak';
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);
fs.writeFileSync(target, source, 'utf8');
console.log('완료: 보유 카드 등록창의 저장 및 나가기 버튼을 하단에 고정했습니다.');
console.log('저장 실패 시 창은 유지됩니다. App.js는 변경하지 않았습니다.');
