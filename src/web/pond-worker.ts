import { runRenderJob, type RenderWorkerRequest, type RenderWorkerResponse } from './render-jobs'

interface WorkerScope {
  onmessage: ((event: MessageEvent<RenderWorkerRequest>) => void) | null
  postMessage(message: RenderWorkerResponse): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = event => {
  const { revision, job } = event.data
  try {
    scope.postMessage({ revision, result: runRenderJob(job) })
  } catch (error) {
    scope.postMessage({ revision, error: error instanceof Error ? error.message : String(error) })
  }
}
