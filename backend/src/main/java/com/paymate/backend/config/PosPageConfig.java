package com.paymate.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** /pos 로 들어오면 백엔드 가상 POS 화면(static/pos/index.html)을 보여 준다 (2026-11-25). */
@Configuration
public class PosPageConfig implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/pos").setViewName("forward:/pos/index.html");
        registry.addViewController("/pos/").setViewName("forward:/pos/index.html");
    }
}
