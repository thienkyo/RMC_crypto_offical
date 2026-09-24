# Plan: Telegram Topics per Strategy

> Status: OPEN — implementing
> Date: 2026-09-24
> PO: Remy

## Goal

Each strategy can choose a Telegram topic, so signals are grouped by ticker (or whatever name Kyo types) inside the RMC Telegram supergroup. Kyo turns on Topics in Telegram himself and makes the bot an admin with "Manage topics".

## Scope

### 1) Strategy editor UI (notify section, next to notifyOnSignal)

- A toggle **"Send to Telegram topic"** (default OFF).
- A text field **"Topic name"**, shown when the toggle is ON.
- Default/placeholder is the strategy's symbol (e.g. BTCUSDT).
- Trim the name; max 128 chars.
- Store on the Strategy definition as:

```ts
telegramTopic?: { enabled: boolean; name: string }
```

- Field is optional so old strategies are unaffected.

### 2) Backend routing (`src/lib/telegram.ts` and the alerts path used by the check-alerts cron)

- Toggle OFF or name empty: send exactly like today (main chat).
- Toggle ON: resolve the name to a `message_thread_id` and send with `message_thread_id`.
- Resolve: look it up in a new table `telegram_topics` (`chat_id`, `name`, `message_thread_id`, `created_at`; `UNIQUE(chat_id, lower(name))`). If missing, call the Bot API `createForumTopic(chat_id, name)`, store the returned `message_thread_id`, then send. Strategies with the same name share one topic.
- Race: two creations of the same new name in one cron tick must not make duplicates (upsert, or re-select after a conflict; if a create lost the race, reuse the winner's id).
- Fallback: if the topic send or create fails (Topics off, no permission, topic deleted, thread not found), log a warning and send to the main chat, so a signal is never lost. On "thread not found", delete the stale row so the next signal recreates the topic.
- Add a DB migration for the table in the repo's existing migration style (`src/lib/db/schema.sql` + `pnpm migrate`).

### 3) Out of scope

- Pinky
- Per-timeframe topics
- Renaming/deleting topics from RMC

## Acceptance

- OFF is identical to today.
- ON with a new name creates the topic once; the next signal reuses it.
- Two strategies with the same name go to one topic.
- With Topics disabled or no permission, the signal still arrives in the main chat with a warning in the log.
- Unit tests cover resolve/create/fallback with the Bot API mocked.
- `tsc` is clean.
