package com.asphalt8.backend.service;

import com.asphalt8.backend.game.model.GeneratedQuestion;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Service;

@Service
public class QuestionGeneratorService {

    private static final List<QuestionTemplate> EASY_TEMPLATES = List.of(
        new QuestionTemplate(
            "{a} + {b}",
            random -> new int[] {randomInt(random, 3, 30), randomInt(random, 2, 20), 0},
            (a, b, c) -> a + b,
            9000,
            1.00
        ),
        new QuestionTemplate(
            "{a} - {b}",
            random -> {
                int b = randomInt(random, 2, 16);
                int a = randomInt(random, b + 3, b + 30);
                return new int[] {a, b, 0};
            },
            (a, b, c) -> a - b,
            9000,
            1.05
        )
    );

    private static final List<QuestionTemplate> MEDIUM_TEMPLATES = List.of(
        new QuestionTemplate(
            "{a} * {b}",
            random -> new int[] {randomInt(random, 4, 14), randomInt(random, 3, 12), 0},
            (a, b, c) -> a * b,
            8000,
            1.20
        ),
        new QuestionTemplate(
            "({a} * {b}) + {c}",
            random -> new int[] {randomInt(random, 4, 11), randomInt(random, 3, 10), randomInt(random, 5, 45)},
            (a, b, c) -> (a * b) + c,
            8000,
            1.25
        )
    );

    private static final List<QuestionTemplate> HARD_TEMPLATES = List.of(
        new QuestionTemplate(
            "({a} * {b}) - {c}",
            random -> {
                int a = randomInt(random, 7, 17);
                int b = randomInt(random, 6, 16);
                int c = randomInt(random, 10, 90);
                return new int[] {a, b, c};
            },
            (a, b, c) -> (a * b) - c,
            7000,
            1.40
        ),
        new QuestionTemplate(
            "({a} + {b}) * {c}",
            random -> new int[] {randomInt(random, 10, 40), randomInt(random, 10, 35), randomInt(random, 4, 10)},
            (a, b, c) -> (a + b) * c,
            7000,
            1.45
        )
    );

    public GeneratedQuestion generateQuestion(int difficulty) {
        int boundedDifficulty = Math.max(1, Math.min(3, difficulty));
        List<QuestionTemplate> pool = switch (boundedDifficulty) {
            case 1 -> EASY_TEMPLATES;
            case 2 -> MEDIUM_TEMPLATES;
            default -> HARD_TEMPLATES;
        };

        ThreadLocalRandom random = ThreadLocalRandom.current();
        QuestionTemplate template = pool.get(random.nextInt(pool.size()));
        int[] operands = template.operandFactory().create(random);

        int a = valueOrDefault(operands, 0, 0);
        int b = valueOrDefault(operands, 1, 0);
        int c = valueOrDefault(operands, 2, 0);
        int result = template.evaluator().apply(a, b, c);

        String prompt = template
            .pattern()
            .replace("{a}", String.valueOf(a))
            .replace("{b}", String.valueOf(b))
            .replace("{c}", String.valueOf(c));

        return new GeneratedQuestion(
            UUID.randomUUID().toString(),
            prompt,
            String.valueOf(result),
            boundedDifficulty,
            template.timeLimitMs(),
            template.boostMultiplier()
        );
    }

    private static int randomInt(ThreadLocalRandom random, int minInclusive, int maxInclusive) {
        return random.nextInt(minInclusive, maxInclusive + 1);
    }

    private static int valueOrDefault(int[] values, int index, int fallback) {
        if (values == null || index < 0 || index >= values.length) {
            return fallback;
        }
        return values[index];
    }

    @FunctionalInterface
    private interface IntTriFunction {
        int apply(int a, int b, int c);
    }

    @FunctionalInterface
    private interface OperandFactory {
        int[] create(ThreadLocalRandom random);
    }

    private record QuestionTemplate(
        String pattern,
        OperandFactory operandFactory,
        IntTriFunction evaluator,
        int timeLimitMs,
        double boostMultiplier
    ) {
    }
}
