package com.paymate.backend.push;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.SecureRandom;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPrivateKeySpec;
import java.security.spec.ECPublicKeySpec;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 웹 푸시 메시지 암호화 (RFC 8291, aes128gcm). 새 라이브러리 없이 JDK 기본 암호화만 쓴다 (2026-11-25).
 *
 * <p>받는 기기(브라우저)가 준 공개 키(p256dh)와 인증 비밀(auth)로, 푸시 서비스가 내용을 볼 수 없게 잠근다.
 * 결과 = 헤더(salt 16 + 레코드 크기 4 + 키 길이 1 + 서버 공개 키 65 = 86바이트) + 암호문.
 */
public final class WebPushCrypto {

    private static final int RECORD_SIZE = 4096;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final ECParameterSpec P256 = p256();

    private WebPushCrypto() {
    }

    /** 무작위 서버 키와 salt 로 암호화한다. */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return encrypt(plaintext, uaPublic65, authSecret16, newKeyPair(), salt);
    }

    /** 서버 키와 salt 를 정해서 암호화한다 (시험용, RFC 8291 부록 A). */
    public static byte[] encrypt(byte[] plaintext, byte[] uaPublic65, byte[] authSecret16, KeyPair asKeys, byte[] salt16) {
        try {
            byte[] asPublic = uncompressed((ECPublicKey) asKeys.getPublic());
            KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
            agreement.init(asKeys.getPrivate());
            agreement.doPhase(publicKey(uaPublic65), true);
            byte[] ecdhSecret = agreement.generateSecret();

            byte[] keyInfo = concat("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPublic65, asPublic);
            byte[] prkKey = hmac(authSecret16, ecdhSecret);
            byte[] ikm = Arrays.copyOf(hmac(prkKey, concat(keyInfo, new byte[] {1})), 32);
            byte[] prk = hmac(salt16, ikm);
            byte[] cek = Arrays.copyOf(hmac(prk, info("Content-Encoding: aes128gcm\0")), 16);
            byte[] nonce = Arrays.copyOf(hmac(prk, info("Content-Encoding: nonce\0")), 12);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
            byte[] encrypted = cipher.doFinal(concat(plaintext, new byte[] {2}));   // 마지막 레코드 표시 0x02

            byte[] header = ByteBuffer.allocate(16 + 4 + 1 + asPublic.length)
                    .put(salt16).putInt(RECORD_SIZE).put((byte) asPublic.length).put(asPublic).array();
            return concat(header, encrypted);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("웹 푸시 암호화 실패", e);
        }
    }

    public static KeyPair newKeyPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"), RANDOM);
            return generator.generateKeyPair();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 65바이트 비압축 점(0x04 ‖ x ‖ y) → 공개 키. */
    public static ECPublicKey publicKey(byte[] uncompressed65) {
        if (uncompressed65 == null || uncompressed65.length != 65 || uncompressed65[0] != 4) {
            throw new IllegalArgumentException("P-256 공개 키는 0x04 로 시작하는 65바이트여야 합니다");
        }
        try {
            BigInteger x = new BigInteger(1, Arrays.copyOfRange(uncompressed65, 1, 33));
            BigInteger y = new BigInteger(1, Arrays.copyOfRange(uncompressed65, 33, 65));
            return (ECPublicKey) KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(x, y), P256));
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("P-256 공개 키가 아닙니다", e);
        }
    }

    /** 32바이트 d → 개인 키. */
    public static ECPrivateKey privateKey(byte[] d32) {
        try {
            return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new ECPrivateKeySpec(new BigInteger(1, d32), P256));
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("P-256 개인 키가 아닙니다", e);
        }
    }

    /** 공개 키 → 65바이트 비압축 점. */
    public static byte[] uncompressed(ECPublicKey key) {
        byte[] out = new byte[65];
        out[0] = 4;
        copyFixed(key.getW().getAffineX(), out, 1);
        copyFixed(key.getW().getAffineY(), out, 33);
        return out;
    }

    public static byte[] b64(String base64url) {
        return Base64.getUrlDecoder().decode(base64url.trim());
    }

    public static String b64(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void copyFixed(BigInteger value, byte[] out, int offset) {
        byte[] raw = value.toByteArray();
        int start = Math.max(0, raw.length - 32);
        int length = raw.length - start;
        System.arraycopy(raw, start, out, offset + 32 - length, length);
    }

    private static byte[] info(String label) {
        return concat(label.getBytes(StandardCharsets.US_ASCII), new byte[] {1});
    }

    private static byte[] hmac(byte[] key, byte[] data) throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] part : parts) {
            out.writeBytes(part);
        }
        return out.toByteArray();
    }

    private static ECParameterSpec p256() {
        try {
            AlgorithmParameters parameters = AlgorithmParameters.getInstance("EC");
            parameters.init(new ECGenParameterSpec("secp256r1"));
            return parameters.getParameterSpec(ECParameterSpec.class);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
