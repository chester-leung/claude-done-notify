import { describe, expect, mock, test } from 'claude-code/testing'

const turn = { answer: 'All 12 tests pass.', durationMs: 12_400, isAborted: false, turnId: 't1' }
const ran = (exitCode: number) => ({
  value: { exitCode, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const answered = (text: string) => ({
  value: { isAnswered: true as const, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
})

describe('done-notify', () => {
  test('names the session from the first typed prompt and uses it as the title', async ($, on) => {
    const clock = mock.clock(on)
    const runs: (readonly string[])[] = []
    on('process.run', ($, e) => (runs.push(e.argv), ran(0)))
    on('session.cwd', () => ({ value: '/Users/me/repos/baku' }))
    on('session.id', () => ({ value: 's1' }))
    on('model.complete', () => answered('Fix Stripe Webhook'))
    on('classic.UserPromptSubmit', () => ({}))
    on('turn.complete', () => ({ text: 'ok' }))

    const submitted = await $.classic.UserPromptSubmit({ prompt: 'the stripe webhook 500s', source: 'user' })
    await $.turn.complete({ ...turn, reason: 'answer' })
    await clock.advance(4000)

    expect(submitted.sessionTitle).toBe('Fix Stripe Webhook')
    const argv = runs[0] ?? []
    expect(argv[2]).toContain('Claude Notifier.app')
    expect(argv.slice(4)).toEqual(['Fix Stripe Webhook', 'Done · 12s · baku', 'All 12 tests pass.', 's1'])
  })

  test('summarizes a long answer and keeps an existing session title', async ($, on) => {
    const clock = mock.clock(on)
    const runs: (readonly string[])[] = []
    on('process.run', ($, e) => (runs.push(e.argv), ran(0)))
    on('session.cwd', () => ({ value: '/Users/me/repos/baku' }))
    on('session.id', () => ({ value: 's1' }))
    on('model.complete', () => answered('Fixed the webhook; needs your OK to deploy.'))
    on('classic.UserPromptSubmit', () => ({}))
    on('turn.complete', () => ({ text: 'ok' }))

    await $.classic.UserPromptSubmit({ prompt: 'hi', source: 'user', session_title: 'Billing Work' })
    await $.turn.complete({ ...turn, answer: 'x'.repeat(500), reason: 'answer' })
    await clock.advance(4000)

    expect(runs[0]?.slice(4, 7)).toEqual(['Billing Work', 'Done · 12s · baku', 'Fixed the webhook; needs your OK to deploy'])
  })

  test('falls back through the notifiers, then a toast', async ($, on) => {
    const clock = mock.clock(on)
    const runs: string[] = []
    const toasts: string[] = []
    on('process.run', ($, e) => (runs.push(e.argv[0] === 'sh' ? (e.argv[2] ?? '').split(' ')[1] ?? '' : e.argv[0] ?? ''), ran(1)))
    on('ui.toast', ($, e) => (toasts.push(e.text), { value: undefined }))
    on('session.cwd', () => ({ value: '/Users/me/repos/baku' }))
    on('session.id', () => ({ value: 's1' }))
    on('turn.complete', () => ({ text: 'ok' }))

    await $.turn.complete({ ...turn, reason: 'error' })
    await clock.advance(4000)

    expect(runs).toEqual(['"$HOME/Applications/Claude', 'terminal-notifier', 'osascript'])
    expect(toasts).toEqual(['baku: All 12 tests pass.'])
  })

  test('stays quiet for interrupted and subagent turns', async ($, on) => {
    const clock = mock.clock(on)
    const runs: (readonly string[])[] = []
    on('process.run', ($, e) => (runs.push(e.argv), ran(0)))
    on('session.cwd', () => ({ value: '/Users/me/repos/baku' }))
    on('session.id', () => ({ value: 's1' }))
    on('turn.complete', () => ({ text: 'ok' }))

    await $.turn.complete({ ...turn, reason: 'aborted', isAborted: true })
    await $.turn.complete({ ...turn, reason: 'answer', agentId: 'sub-1' })
    await clock.advance(10_000)

    expect(runs).toEqual([])
  })

  test('/done-notify-setup reports what the script printed', async ($, on) => {
    on('process.run', () => ({
      value: { exitCode: 1, stdout: 'terminal-notifier is not installed.', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('command.run', () => ({ text: 'unhandled' }))

    const r = await $.command.run({
      command: 'done-notify-setup',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    expect(r.text).toBe('Setup failed:\nterminal-notifier is not installed.')
  })

  test('only the last turn of a run notifies', async ($, on) => {
    const clock = mock.clock(on)
    const messages: string[] = []
    on('process.run', ($, e) => (messages.push(e.argv[6] ?? ''), ran(0)))
    on('session.cwd', () => ({ value: '/Users/me/repos/baku' }))
    on('session.id', () => ({ value: 's1' }))
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: 'ok' }))

    await $.turn.complete({ ...turn, answer: 'Working on it.', reason: 'answer' })
    await clock.advance(1000)
    await $.turn.start({ text: 'also do X', turnId: 't2' })
    await $.turn.complete({ ...turn, answer: 'Did it and X.', turnId: 't2', reason: 'answer' })
    await clock.advance(4000)

    expect(messages).toEqual(['Did it and X.'])
  })
})
