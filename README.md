# done-notify

A Claude Code plugin that sends a macOS notification when Claude finishes working in a session:

```
Fix Stripe Webhook                         ← the session's name
Done · 42s · baku                          ← status · turn time · project
Fixed the 500; needs your OK to deploy.    ← one-line summary of Claude's last message
```

- Notifies once per run of work, on the final message. A turn that's followed right away by another (a message typed mid-turn, a background task reporting in) doesn't notify.
- Names each new session from its first prompt (Haiku) and renames the session to match.
- Summarizes replies longer than 100 characters (Haiku); shorter ones are shown as is.
- Clicking a notification brings back the terminal the session runs in.
- Skips interrupted turns and subagent turns.

## Install

In Claude Code, in a terminal:

```
/plugin install done-notify --marketplace chester-leung/claude-done-notify
```

Answer `y` to add the marketplace, then pick the user scope.

Then set up the notifier (macOS only):

1. Install terminal-notifier: `nix profile add nixpkgs#terminal-notifier` or `brew install terminal-notifier`.
2. In Claude Code, run `/done-notify-setup`. It builds `~/Applications/Claude Notifier.app`, a copy of terminal-notifier with the Claude desktop app's icon, and sends a test notification.
3. Allow notifications when macOS asks. If nothing appears: System Settings → Notifications → **Claude Code** → turn on Allow notifications, pick Banners or Alerts, and check that Focus is off.

Without step 2, notifications still go out through plain `terminal-notifier` or `osascript`, then fall back to a toast inside Claude Code.

## Cost

Up to two small Haiku calls per finished run (a summary when the reply is long) plus one per new session (its name), on your Claude Code account.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
