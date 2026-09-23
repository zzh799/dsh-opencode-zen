// @vitest-environment jsdom

/**
 * The Go quota pill in the conversation composer: mounted only while the
 * selected model belongs to the Go plan, polling while it is, and never
 * turning an unreadable quota into a claim about the account.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { afterEach, expect, it, vi } from 'vitest'
import { UsagePill } from '../src/client/UsagePill.tsx'
import { en } from '../src/client/locales.ts'
import type { GoUsageProbe } from '../src/usage-contract.ts'

afterEach(() => { cleanup(); vi.useRealTimers() })
const t = (key: string) => en[key as keyof typeof en]
const window = { status: 'ok' as const, percent: 10, resetsAt: '2026-09-21T00:00:00Z' }
const usage = { rolling: { ...window, percent: 0 }, weekly: window, monthly: { ...window, percent: 7 } }
const subscribed: GoUsageProbe = { status: 'subscribed', usage }
const directory = () => createSnapshotStore<ModelDirectoryState>({
  current: { provider: 'deepseek', model: 'deepseek-chat' }, routable: true,
  groups: [], failures: [], status: 'ready', error: null,
})
const selectGo = (store: ReturnType<typeof directory>) => {
  store.set({ ...store.getSnapshot(), current: { provider: 'opencode-go', model: 'deepseek-v4-flash' } })
}

it('appears only for Go, shows all account windows, and stops polling when switching away', async () => {
  vi.useFakeTimers()
  const store = directory()
  const read = vi.fn().mockResolvedValue(subscribed)
  render(<UsagePill directory={store} readUsage={read} t={t} />)
  expect(read).not.toHaveBeenCalled()
  await act(async () => { selectGo(store) })
  fireEvent.click(screen.getByRole('button', { name: /Go · 5h 0% · week 10%/ }))
  expect(screen.getByRole('progressbar', { name: en.usage_monthly }).getAttribute('value')).toBe('7')
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => {
    store.set({ ...store.getSnapshot(), current: { provider: 'deepseek', model: 'deepseek-chat' } })
  })
  expect(screen.queryByRole('button')).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(read).toHaveBeenCalledTimes(2)
})

it('drops the percentages on screen when the endpoint stops confirming a subscription', async () => {
  vi.useFakeTimers()
  const store = directory()
  selectGo(store)
  const read = vi.fn()
    .mockResolvedValueOnce(subscribed)
    .mockResolvedValue({ status: 'not-subscribed' } satisfies GoUsageProbe)
  await act(async () => { render(<UsagePill directory={store} readUsage={read} t={t} />) })
  expect(screen.getByText('Go · 5h 0% · week 10%')).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(screen.getByText(`Go · ${en.usageUnavailable}`)).toBeTruthy()
  expect(screen.queryByText('Go · 5h 0% · week 10%')).toBeNull()
})

it('reads an unknown outcome as unavailable too, and a rejection not at all as a verdict', async () => {
  vi.useFakeTimers()
  const unknown = directory()
  selectGo(unknown)
  const unknownRead = vi.fn().mockResolvedValue({ status: 'unknown', message: 'offline' } satisfies GoUsageProbe)
  await act(async () => { render(<UsagePill directory={unknown} readUsage={unknownRead} t={t} />) })
  expect(screen.getByText(`Go · ${en.usageUnavailable}`)).toBeTruthy()

  const rejected = directory()
  selectGo(rejected)
  const rejectedRead = vi.fn().mockRejectedValue(new Error('offline'))
  await act(async () => { render(<UsagePill directory={rejected} readUsage={rejectedRead} t={t} />) })
  expect(screen.getAllByText(`Go · ${en.usageUnavailable}`).length).toBeGreaterThan(0)
})
