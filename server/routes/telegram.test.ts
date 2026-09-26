import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "http";
import { telegramService } from "../telegram/TelegramService.js";
import { createTelegramRouter } from "./telegram.js";

test("TelegramService: initial status and config", () => {
  const status = telegramService.getStatus();
  assert.equal(typeof status.isRunning, "boolean");
  assert.equal(typeof status.isConfigured, "boolean");
  assert.equal(typeof status.allowedUsersCount, "number");
});

test("TelegramService: save and get config", () => {
  const initialConfig = telegramService.getConfig();
  const testUsers = ["123456789", "testuser"];

  telegramService.saveConfig({
    allowedUsers: testUsers,
    autoStart: true,
    notificationsEnabled: false,
    defaultChatId: "987654321",
  });

  const updatedConfig = telegramService.getConfig();
  assert.deepEqual(updatedConfig.allowedUsers, testUsers);
  assert.equal(updatedConfig.autoStart, true);
  assert.equal(updatedConfig.notificationsEnabled, false);
  assert.equal(updatedConfig.defaultChatId, "987654321");

  // Restaurer
  telegramService.saveConfig({
    allowedUsers: initialConfig.allowedUsers,
    autoStart: initialConfig.autoStart,
    notificationsEnabled: initialConfig.notificationsEnabled,
    defaultChatId: initialConfig.defaultChatId,
  });
});

test("Telegram API Routes: /api/telegram/status and /api/telegram/config", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/telegram", createTelegramRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Test GET /status
    const resStatus = await fetch(`${baseUrl}/api/telegram/status`);
    assert.equal(resStatus.status, 200);
    const bodyStatus = await resStatus.json();
    assert.equal(bodyStatus.status, "success");
    assert.ok("isRunning" in bodyStatus.data);

    // Test GET /config
    const resConfig = await fetch(`${baseUrl}/api/telegram/config`);
    assert.equal(resConfig.status, 200);
    const bodyConfig = await resConfig.json();
    assert.equal(bodyConfig.status, "success");
    assert.ok("hasToken" in bodyConfig.config);

    // Test POST /config
    const resPost = await fetch(`${baseUrl}/api/telegram/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowedUsers: ["user_test_42"],
        autoStart: false,
        notificationsEnabled: true,
      }),
    });
    assert.equal(resPost.status, 200);
    const bodyPost = await resPost.json();
    assert.equal(bodyPost.status, "success");
    assert.equal(telegramService.getConfig().allowedUsers.includes("user_test_42"), true);

    // Test POST /start with invalid/empty token
    telegramService.saveConfig({ botToken: "" });
    const resStart = await fetch(`${baseUrl}/api/telegram/start`, { method: "POST" });
    assert.equal(resStart.status, 400);
    const bodyStart = await resStart.json();
    assert.equal(bodyStart.status, "error");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
