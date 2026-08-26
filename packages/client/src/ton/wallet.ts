import { TonConnectUI } from '@tonconnect/ui';
import { CONFIG } from '../config.js';

/**
 * TonConnect wrapper. initWallet() renders the standard TonConnect button
 * into the #ton-connect element of the DOM overlay (see index.html) and lets
 * the user connect Tonkeeper, MyTonWallet, etc.
 */

let ui: TonConnectUI | null = null;

export function initWallet(onChange: (address: string | null) => void): TonConnectUI {
  if (!ui) {
    ui = new TonConnectUI({
      manifestUrl: CONFIG.manifestUrl,
      buttonRootId: 'ton-connect',
    });
    // The game surfaces its own transaction status (pull panel, launch log),
    // so TonConnect's floating toasts are noise in odd places — off. Inside
    // a Telegram Mini App, twaReturnUrl brings the wallet back to the app.
    ui.uiOptions = {
      actionsConfiguration: {
        notifications: [],
        ...(CONFIG.twaReturnUrl ? { twaReturnUrl: CONFIG.twaReturnUrl as `${string}://${string}` } : {}),
      },
    };
    ui.onStatusChange((wallet) => {
      onChange(wallet ? wallet.account.address : null);
    });
  }
  return ui;
}

/** Raw (0:hex) address of the connected wallet, or null. */
export function walletAddress(): string | null {
  return ui?.account?.address ?? null;
}

/** The TonConnect UI instance, for flows that send transactions (e.g. pulls). */
export function tonConnect(): TonConnectUI | null {
  return ui;
}
