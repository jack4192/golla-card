import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

export default forwardRef(function PinDotsInput({ value, editable = true, ...props }, ref) {
  const input = useRef(null);
  useImperativeHandle(ref, () => input.current, []);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (input.current?.isFocused()) input.current.blur();
    });
    return () => subscription.remove();
  }, []);

  return (
    <Pressable
      accessible={false}
      focusable={false}
      disabled={!editable}
      onPress={() => input.current?.focus()}
      style={styles.field}
    >
      <View accessible={false} pointerEvents="none" style={styles.dots}>
        {Array.from({ length: 6 }, (_, index) => (
          <View key={index} style={[styles.dot, index < value.length && styles.filled]} />
        ))}
      </View>
      <TextInput
        {...props}
        ref={input}
        style={styles.input}
        pointerEvents="none"
        editable={editable}
        value={value}
        secureTextEntry
        keyboardType="number-pad"
        maxLength={6}
        caretHidden
        autoCorrect={false}
        selectionColor="transparent"
        underlineColorAndroid="transparent"
      />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  field: {
    height: 76,
    width: '100%',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D9E3F4',
    backgroundColor: '#FFFFFF',
  },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  dot: {
    height: 16,
    width: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#9FACC0',
    backgroundColor: '#FFFFFF',
  },
  filled: {
    backgroundColor: '#1658DF',
    borderColor: '#1658DF',
  },
  input: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    color: 'transparent',
    backgroundColor: 'transparent',
    padding: 0,
  },
});
