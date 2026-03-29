package com.asphalt8.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class Asphalt8Application {

    public static void main(String[] args) {
        SpringApplication.run(Asphalt8Application.class, args);
    }
}
