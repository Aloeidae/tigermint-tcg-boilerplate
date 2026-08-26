/**
 * Telegram Mini App bootstrap. TON games distribute naturally through
 * Telegram: register a bot with @BotFather, give it a Web App pointing at
 * your deployed client URL, and this file makes the game behave inside the
 * Telegram webview — expanded to full height, vertical swipes disabled so
 * drag-to-play doesn't minimize the app.
 *
 * Outside Telegram this is a silent no-op; the game stays a normal web app.
 * (index.html loads Telegram's official telegram-web-app.js, which defines
 * window.Telegram.WebApp only when actually running inside Telegram.)
 *
 * For wallets to hop back into the Mini App after signing a transaction,
 * set VITE_TWA_RETURN_URL to your app's t.me deep link — see wallet.ts.
 */

interface TelegramWebApp {
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  isExpanded?: boolean;
}

export function initTma(): boolean {
  const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  if (!tg) return false;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
  } catch {
    // Older Telegram clients miss some of these — best effort.
  }
  return true;
}

export function isTma(): boolean {
  return Boolean((window as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp);
}
