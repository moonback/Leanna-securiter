export interface TelegramConfig {
  botToken?: string;
  allowedUsers: string[];
  autoStart: boolean;
  notificationsEnabled: boolean;
  defaultChatId?: string;
}

export interface TelegramBotInfo {
  id: number;
  username: string;
  firstName: string;
}

export interface TelegramStatus {
  isRunning: boolean;
  isConfigured: boolean;
  botInfo: TelegramBotInfo | null;
  allowedUsersCount: number;
  autoStart: boolean;
  notificationsEnabled: boolean;
  defaultChatId?: string;
  lastError: string | null;
}

export interface TelegramChatInfo {
  chatId: string;
  type?: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface TelegramSendResult {
  success: boolean;
  chatId?: string;
  messageId?: number;
  error?: string;
}

export interface TelegramBroadcastResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ chatId: string; error: string }>;
}
