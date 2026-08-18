export class SupersededJobError extends Error {
  constructor() {
    super('Render superseded by a newer state')
    this.name = 'SupersededJobError'
  }
}

export interface LatestJobQueueState {
  active: boolean
  queued: boolean
  superseded: number
}

interface QueueEntry<TJob, TResult> {
  job: TJob
  resolve: (result: TResult) => void
  reject: (error: unknown) => void
}

export class LatestJobQueue<TJob, TResult> {
  private active = false
  private queued: QueueEntry<TJob, TResult> | null = null
  private superseded = 0

  constructor(
    private readonly execute: (job: TJob) => Promise<TResult>,
    private readonly onChange?: (state: LatestJobQueueState) => void,
  ) {}

  enqueue(job: TJob): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const entry = { job, resolve, reject }
      if (!this.active) {
        this.start(entry)
        return
      }

      if (this.queued) {
        this.queued.reject(new SupersededJobError())
        this.superseded += 1
      }
      this.queued = entry
      this.notify()
    })
  }

  private start(entry: QueueEntry<TJob, TResult>) {
    this.active = true
    this.notify()
    void this.execute(entry.job)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        this.active = false
        const next = this.queued
        this.queued = null
        if (next) this.start(next)
        else this.notify()
      })
  }

  private notify() {
    this.onChange?.({
      active: this.active,
      queued: this.queued !== null,
      superseded: this.superseded,
    })
  }
}
