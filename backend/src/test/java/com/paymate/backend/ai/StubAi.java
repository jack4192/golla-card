package com.paymate.backend.ai;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;

/** 테스트용 가짜 AI 엔진. 받은 요청을 기록하고, 경로별로 정해 둔 답을 돌려준다. */
class StubAi implements AutoCloseable {

    record Received(String method, String path, String query, String token, String body) {
    }

    private record Reply(int status, String body, long delayMs) {
    }

    private final HttpServer server;
    private final List<Received> received = new CopyOnWriteArrayList<>();
    private final Map<String, Reply> replies = new ConcurrentHashMap<>();

    StubAi() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", this::handle);
        server.start();
    }

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** 경로가 path 로 시작하는 요청에 이 답을 준다. 정하지 않은 경로는 200 {} 이다. */
    StubAi reply(String path, int status, String body) {
        replies.put(path, new Reply(status, body, 0));
        return this;
    }

    StubAi slow(String path, long delayMs) {
        replies.put(path, new Reply(200, "{}", delayMs));
        return this;
    }

    List<Received> received() {
        return new ArrayList<>(received);
    }

    Received last() {
        return received.get(received.size() - 1);
    }

    private void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        received.add(new Received(exchange.getRequestMethod(), path, exchange.getRequestURI().getQuery(),
                exchange.getRequestHeaders().getFirst("X-Internal-Token"), body));
        Reply reply = replies.entrySet().stream()
                .filter(e -> path.startsWith(e.getKey()))
                .map(Map.Entry::getValue)
                .findFirst()
                .orElse(new Reply(200, "{}", 0));
        if (reply.delayMs() > 0) {
            try {
                Thread.sleep(reply.delayMs());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        byte[] bytes = reply.body().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(reply.status(), bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
