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
    private Boolean notificationAgreed;      // 알림 수신 동의(선택). null = 아직 응답 안 함

    @Column(name = "workplace_name", length = 100)
    private String workplaceName;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false, length = 20)
    private UserRole role;

    protected User() {
    }

    public void agreeMydata() {
        this.mydataAgreed = true;
    }

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
