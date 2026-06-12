import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ONLINE_VISIBILITY_OPTIMIZATION_MODULE } from "../modules/online_visibility_optimization"

/**
 * Workflow: run an AI-citation scan across all active prompts and
 * configured providers. Exposed so a host app can trigger a scan from
 * its own code / an event, reusing the exact same service method the
 * weekly cron and the admin "Run now" button call.
 */
const runAiCitationScanStep = createStep(
  "ovo-run-ai-citation-scan-step",
  async (_input: { trigger?: string } | undefined, { container }) => {
    const ovo = container.resolve(
      ONLINE_VISIBILITY_OPTIMIZATION_MODULE,
    ) as { runAiCitationsForAll: (o: { trigger?: string }) => Promise<unknown> }
    const result = await ovo.runAiCitationsForAll({
      trigger: _input?.trigger ?? "workflow",
    })
    return new StepResponse(result)
  },
)

export const runAiCitationScanWorkflow = createWorkflow(
  "ovo-run-ai-citation-scan",
  (input: { trigger?: string }) => {
    const result = runAiCitationScanStep(input)
    return new WorkflowResponse(result)
  },
)

export default runAiCitationScanWorkflow
