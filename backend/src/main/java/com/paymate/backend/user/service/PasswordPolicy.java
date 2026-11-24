package com.paymate.backend.user.service;

import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * 가입 비밀번호 규칙 (2026-11-24 점검 문제 5): 앱(SignUpScreen.isValidSignUpPassword)과 같은 규칙
 * — 8글자 이상, 영문·숫자·특수문자(문장부호·기호)를 모두 포함. BCrypt 는 72바이트까지만 쓰므로 UTF-8 72바이트 이하.
 */
public final class PasswordPolicy {

    private static final Pattern LETTER = Pattern.compile("[A-Za-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");
    private static final Pattern SPECIAL = Pattern.compile("[\\p{P}\\p{S}]");
    private static final int MIN_LENGTH = 8;
    private static final int MAX_BYTES = 72;

    private PasswordPolicy() {
    }

    public static boolean isValid(String password) {
        if (password == null) {
            return false;
        }
        return password.codePointCount(0, password.length()) >= MIN_LENGTH
                && password.getBytes(StandardCharsets.UTF_8).length <= MAX_BYTES
                && LETTER.matcher(password).find()
                && DIGIT.matcher(password).find()
                && SPECIAL.matcher(password).find();
    }
}
