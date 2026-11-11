import { PageHead } from "../shell/PageHead.tsx";
export function Privacy() {
  return (
    <div className="prose">
      <PageHead path="/privacy" title="Privacy and terms." rest="The short version: almost nothing is kept." lede="Nutus is a static web app. There is no Nutus account, no sign-up, and no database of what you do here." />

      <h2>What the app reads</h2>
      <p>
        It reads public data from the NEAR blockchain through the RPC endpoints in the build. The DAO or instance address you enter is sent to those
        endpoints so they can answer. The mainnet numbers on the home page are a file built into the app, not a live query.
      </p>

      <h2>What stays in your browser</h2>
      <p>
        Your wallet connection is kept by NEAR Wallet Selector in this browser. The app sets no cookies, runs no analytics, and keeps no profile of you.
        Signing out clears the connection; your wallet may keep its own session.
      </p>

      <h2>If you use the Telegram bot</h2>
      <p>
        The bot keeps each chat's id and the alert settings chosen there (which alerts, how often), plus alerts waiting for the next summary. Nothing
        else about you. Send <span className="mono">/stop</span> in the chat and that record is deleted.
      </p>

      <h2>What you sign is public</h2>
      <p>
        Payouts, proposals and votes go to NEAR and are public on chain. Nutus never sees your private key: your wallet signs every transaction. Check
        each transaction in your wallet before you approve it.
      </p>

      <h2>Terms</h2>
      <p>
        Nutus is experimental software, provided as is and without warranty. It prepares transactions for you to review and sign; you are responsible
        for what you sign. The DAO's own Sputnik contract is never changed.
      </p>
    </div>
  );
}
