import { describe, expect, it } from 'vitest'
import { LatestJobQueue, SupersededJobError, type LatestJobQueueState } from '../src/web/latest-job-queue'

describe('latest render job queue', () => {
  it('finishes the active job and keeps only the newest waiting job', async () => {
    const started: number[] = []
    const completions: Array<(value: string) => void> = []
    const states: LatestJobQueueState[] = []
    const queue = new LatestJobQueue<number, string>(job => {
      started.push(job)
      return new Promise(resolve => completions.push(resolve))
    }, state => states.push(state))

    const first = queue.enqueue(1)
    const second = queue.enqueue(2).catch(error => error)
    const third = queue.enqueue(3)

    expect(started).toEqual([1])
    expect(await second).toBeInstanceOf(SupersededJobError)
    completions[0]('first')
    await expect(first).resolves.toBe('first')
    await Promise.resolve()
    expect(started).toEqual([1, 3])

    completions[1]('third')
    await expect(third).resolves.toBe('third')
    await Promise.resolve()
    expect(states.at(-1)).toEqual({ active: false, queued: false, superseded: 1 })
  })

  it('continues with the latest job after an active job fails', async () => {
    const failures: Array<(error: Error) => void> = []
    const completions: Array<(value: number) => void> = []
    const queue = new LatestJobQueue<number, number>(job => new Promise((resolve, reject) => {
      completions[job] = resolve
      failures[job] = reject
    }))

    const first = queue.enqueue(0)
    const latest = queue.enqueue(1)
    failures[0](new Error('worker failed'))
    await expect(first).rejects.toThrow('worker failed')
    await Promise.resolve()
    completions[1](1)
    await expect(latest).resolves.toBe(1)
  })
})
