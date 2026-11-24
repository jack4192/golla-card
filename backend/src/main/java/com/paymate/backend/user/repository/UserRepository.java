package com.paymate.backend.user.repository;

import com.paymate.backend.user.entity.User;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    // 이메일은 소문자로 통일해 저장하지만, 예전에 대문자로 저장된 계정도 찾을 수 있게 대소문자 무시 조회를 둔다 (2026-11-24)
    boolean existsByEmailIgnoreCase(String email);

    Optional<User> findFirstByEmailIgnoreCaseOrderByIdAsc(String email);

    boolean existsByPhone(String phone);
}
