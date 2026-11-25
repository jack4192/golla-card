package com.paymate.backend.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import org.junit.jupiter.api.Test;

/** 웹 푸시 암호화: RFC 8291 부록 A 의 값과 같은 결과가 나와야 한다. */
class WebPushCryptoTest {

    // RFC 8291 Appendix A
    private static final String PLAINTEXT = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24";
    private static final String AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private static final String AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    private static final String UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    private static final String SALT = "DGv6ra1nlYgDCS1FRnbzlw";
    private static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
    private static final String HEADER = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
    private static final String CIPHER = "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";

    @Test
    void rfc8291AppendixA() {
        KeyPair asKeys = new KeyPair(WebPushCrypto.publicKey(WebPushCrypto.b64(AS_PUBLIC)),
                WebPushCrypto.privateKey(WebPushCrypto.b64(AS_PRIVATE)));

        byte[] body = WebPushCrypto.encrypt(WebPushCrypto.b64(PLAINTEXT), WebPushCrypto.b64(UA_PUBLIC),
                WebPushCrypto.b64(AUTH), asKeys, WebPushCrypto.b64(SALT));

        byte[] header = WebPushCrypto.b64(HEADER);
        byte[] cipher = WebPushCrypto.b64(CIPHER);
        byte[] expected = new byte[header.length + cipher.length];
        System.arraycopy(header, 0, expected, 0, header.length);
        System.arraycopy(cipher, 0, expected, header.length, cipher.length);
        assertThat(header).hasSize(86);
        assertThat(body).isEqualTo(expected);
    }

    @Test
    void publicKeyRoundTrip() {
        byte[] raw = WebPushCrypto.b64(AS_PUBLIC);
        assertThat(WebPushCrypto.uncompressed(WebPushCrypto.publicKey(raw))).isEqualTo(raw);
    }

    @Test
    void randomKeysDiffer() {
        byte[] plaintext = "좋은 아침이에요".getBytes(StandardCharsets.UTF_8);
        byte[] first = WebPushCrypto.encrypt(plaintext, WebPushCrypto.b64(UA_PUBLIC), WebPushCrypto.b64(AUTH));
        byte[] second = WebPushCrypto.encrypt(plaintext, WebPushCrypto.b64(UA_PUBLIC), WebPushCrypto.b64(AUTH));

        assertThat(first).isNotEqualTo(second);
        assertThat(first).hasSize(86 + plaintext.length + 1 + 16);
        assertThat(second).hasSize(86 + plaintext.length + 1 + 16);
    }
}
