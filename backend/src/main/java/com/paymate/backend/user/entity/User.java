package com.paymate.backend.user.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import lombok.Getter;

@Getter
@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "user_id")
    private Long id;

    @Column(name = "name", nullable = false, length = 50)
    private String name;

    @Column(name = "birth_date", nullable = false)
    private LocalDate birthDate;

    @Column(name = "phone", nullable = false, unique = true, length = 20)
    private String phone;

    @Column(name = "email", nullable = false, unique = true, length = 100)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 100)
    private String passwordHash;

    @Column(name = "mydata_agreed")
    private Boolean mydataAgreed;

    @Column(name = "notification_agreed")
    private Boolean notificationAgreed;      // 알림 수신 동의(선택, 2026-11-24). null = 아직 응답 안 함

    @Column(name = "workplace_name", length = 100)
    private String workplaceName;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 20)
    private UserRole role;

    protected User() {
    }

    /** 가입 화면에서 고른 직장 (2026-11-24). 빈 값이면 null. */
    public void changeWorkplaceName(String workplaceName) {
        this.workplaceName = workplaceName == null || workplaceName.isBlank() ? null : workplaceName.trim();
    }

    /** 필수 서비스 이용 동의 (2026-11-24 사용자 결정: 기존 mydata_agreed 칸에 저장, 철회하면 false). */
    public void agreeMydata(boolean agreed) {
        this.mydataAgreed = agreed;
    }

    /** 알림 수신 동의 (선택, 2026-11-24 사용자 결정: 서버에도 저장). */
    public void changeNotificationAgreed(boolean agreed) {
        this.notificationAgreed = agreed;
    }

    public User(String name, LocalDate birthDate, String phone, String email, String passwordHash) {
        this.name = name;
        this.birthDate = birthDate;
        this.phone = phone;
        this.email = email;
        this.passwordHash = passwordHash;
        this.role = UserRole.USER;
    }
}
