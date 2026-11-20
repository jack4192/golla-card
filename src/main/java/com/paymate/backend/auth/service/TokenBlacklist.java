package com.paymate.backend.auth.service;

import java.util.Date;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class TokenBlacklist {

    private final Map<String, Long> revoked = new ConcurrentHashMap<>();

    public void revoke(String jti, Date expiresAt) {
        purgeExpired();
        revoked.put(jti, expiresAt.getTime());
    }

    public boolean isRevoked(String jti) {
        Long expiresAt = revoked.get(jti);
        return expiresAt != null && expiresAt > System.currentTimeMillis();
    }

    private void purgeExpired() {
        long now = System.currentTimeMillis();
        revoked.values().removeIf(expiresAt -> expiresAt <= now);
    }
}
