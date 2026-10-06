import type { EngineInterface, Register } from 'claude-code'

type Note = { title: string; subtitle: string; message: string; group: string }

// Built by /done-notify-setup: a copy of terminal-notifier.app carrying the Claude
// app's icon, since macOS draws the sending app's own icon and ignores -appIcon.
const NOTIFIER = '$HOME/Applications/Claude Notifier.app/Contents/MacOS/terminal-notifier'

// Clicking a notification brings back the terminal the session runs in: macOS
// gives every process an app launches __CFBundleIdentifier (Ghostty, iTerm, ...).
const TERMINAL_NOTIFIER = (bin: string) => [
  'sh',
  '-c',
  `exec ${bin} -title "$1" -subtitle "$2" -message "$3" -group "$4" -sound Glass -activate "\${__CFBundleIdentifier:-com.apple.Terminal}"`,
  'sh',
]

// Text arrives as argv so quotes in a title can't break the script.
const OSASCRIPT = [
  'osascript',
  ...[
    'on run argv',
    'display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv) sound name "Glass"',
    'end run',
  ].flatMap(line => ['-e', line]),
]

// Run as `sh -c SETUP sh`; prints what it did, exits non-zero with the reason.
const SETUP = String.raw`
set -e
tn=$(command -v terminal-notifier) || {
  echo "terminal-notifier is not installed. Install it with one of:"
  echo "  nix profile add nixpkgs#terminal-notifier"
  echo "  brew install terminal-notifier"
  exit 1
}
real=$(readlink -f "$tn")
src=$(find "$(dirname "$real")/.." "$(dirname "$real")/../.." -maxdepth 3 -name terminal-notifier.app -type d 2>/dev/null | head -n 1)
[ -n "$src" ] || { echo "Could not find terminal-notifier.app next to $real"; exit 1; }

app="$HOME/Applications/Claude Notifier.app"
mkdir -p "$HOME/Applications"
rm -rf "$app"
/bin/cp -R "$src" "$app"
chmod -R u+w "$app"

plist="$app/Contents/Info.plist"
icon=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" "$plist")
claude_icon=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIconFile" /Applications/Claude.app/Contents/Info.plist 2>/dev/null || true)
if [ -n "$claude_icon" ]; then
  /bin/cp -f "/Applications/Claude.app/Contents/Resources/$(basename "$claude_icon" .icns).icns" "$app/Contents/Resources/$(basename "$icon" .icns).icns"
  echo "Icon: the Claude app's"
else
  echo "Icon: terminal-notifier's (install the Claude desktop app for its icon, then run this again)"
fi
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.chesterleung.claude-notifier" -c "Set :CFBundleName Claude Code" "$plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Claude Code" "$plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Claude Code" "$plist"
codesign --force --deep --sign - "$app" >/dev/null 2>&1
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
"$app/Contents/MacOS/terminal-notifier" -title "Claude Code" -message "Notifications are set up" -sound Glass >/dev/null 2>&1 &
echo "Built $app"
`

const SETUP_HINT = [
  'Sent a test notification. If it did not appear: System Settings → Notifications → Claude Code,',
  'turn on Allow notifications and pick Banners or Alerts (and check that Focus is off).',
].join('\n')

// Each runner throws when its program is missing; a non-zero exit counts as failed too.
async function notify($: EngineInterface, note: Note): Promise<boolean> {
  const args = [note.title, note.subtitle, note.message, note.group]
  const runners: (readonly string[])[] = [
    [...TERMINAL_NOTIFIER(`"${NOTIFIER}"`), ...args],
    [...TERMINAL_NOTIFIER('terminal-notifier'), ...args],
    [...OSASCRIPT, ...args],
  ]
  for (const argv of runners) {
    try {
      if ((await $.process.run(argv, { timeoutMs: 10_000 })).exitCode === 0) {
        return true
      }
    } catch {}
  }

  return false
}

async function ask($: EngineInterface, prompt: string, maxTokens: number): Promise<string | undefined> {
  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens, effort: 'low', timeoutMs: 15_000 })
  const text = r.isAnswered ? r.text.trim().replace(/^["'`]+|["'`.]+$/g, '') : ''

  return text === '' ? undefined : text
}

const nameSession = ($: EngineInterface, prompt: string) =>
  ask(
    $,
    `Name this coding session in 2-5 words, Title Case, no punctuation. Reply with the name only.\n\nFirst request:\n${prompt.slice(0, 2000)}`,
    20,
  )

const summarize = ($: EngineInterface, answer: string) =>
  ask(
    $,
    `This is the final message a coding assistant just sent. In one plain sentence of at most 100 characters, say what it did or what it needs from the user. No markdown. Reply with the sentence only.\n\n${answer.slice(-6000)}`,
    60,
  )

async function announce($: EngineInterface, title: string | undefined, reason: string, answer: string, durationMs: number) {
  const cwd = await $.session.cwd()
  const project = cwd.split('/').filter(Boolean).pop() ?? cwd
  const seconds = Math.round(durationMs / 1000)
  const status = reason === 'answer' ? 'Done' : `Stopped (${reason})`
  const text = answer.trim()
  const message = text.length <= 100 ? text : (await summarize($, text)) ?? `${text.slice(0, 97)}...`

  const note: Note = {
    title: title ?? project,
    subtitle: `${status} · ${seconds}s · ${project}`,
    message: message === '' ? status : message,
    // A newer notification from the same session replaces the older one.
    group: await $.session.id(),
  }
  if (!(await notify($, note))) {
    $.ui.toast(`${note.title}: ${note.message}`)
  }
}

export const register: Register = on => {
  // The session's name; restored from the next prompt's input after a reload.
  let title: string | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'done-notify-setup',
      description: 'Build the Claude Notifier app that done-notify sends macOS notifications through',
    })

    return next(e)
  })

  on('command.run', { command: 'done-notify-setup' }, async $ => {
    const { exitCode, stdout, stderr } = await $.process.run(['sh', '-c', SETUP, 'sh'], { timeoutMs: 60_000 })
    const output = `${stdout}${stderr}`.trim()

    return { text: exitCode === 0 ? `${output}\n\n${SETUP_HINT}` : `Setup failed:\n${output}` }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    title = result.sessionTitle ?? e.session_title ?? title

    // Name the session once, from the first prompt the user typed.
    const isTyped = e.source === undefined || e.source === 'user'
    if (title !== undefined || !isTyped || e.prompt.trim() === '' || e.prompt.startsWith('/')) {
      return result
    }

    title = await nameSession($, e.prompt)

    return title === undefined ? result : { ...result, sessionTitle: title }
  })

  // Wait this long after a turn ends before notifying: a turn that starts right
  // away (a message typed mid-turn, a background task reporting in) means the
  // work is still going, and only the last turn's answer is worth a notification.
  const SETTLE_MS = 4000
  let pending: { cancel: () => void } | undefined

  on('turn.start', ($, e, next) => {
    pending?.cancel()
    pending = undefined

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // Main loop only: skip subagent turns and turns the user interrupted.
    if (e.agentId !== undefined || e.reason === 'aborted') {
      return result
    }

    pending?.cancel()
    pending = $.clock.after(SETTLE_MS, () => {
      pending = undefined
      void announce($, title, e.reason, e.answer, e.durationMs)
    })

    return result
  })
}
