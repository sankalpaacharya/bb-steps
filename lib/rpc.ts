import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { focusedStepsSchema, stepSchema } from "./steps";

/** The most of a thread's messages the list reads. */
export const MAX_TURNS = 200;

/** One thread's steps, invalidated when that thread changes. */
export const stepsTag = (threadId: string): string => `steps:${threadId}`;

const threadId = z.string().min(1).max(200);
const turns = z.number().int().min(1).max(MAX_TURNS);

export const rpcContract = defineRpcContract({
  /** The thread's newest `turns` messages, with the steps of the one in focus. */
  thread_steps: {
    input: z.strictObject({
      threadId,
      turns,
      turnId: z.string().min(1).max(1000).nullable(),
    }),
    output: focusedStepsSchema,
    tags: ({ threadId }) => [stepsTag(threadId)],
  },
  /** Every step of a thread started from another, read only when it is opened. */
  thread_run: {
    input: z.strictObject({ threadId }),
    output: z.object({ steps: z.array(stepSchema) }),
    tags: ({ threadId }) => [stepsTag(threadId)],
  },
  /** A step's own output, read only when the step is opened. */
  step_output: {
    input: z.strictObject({
      threadId,
      stepId: z.string().min(1).max(1000),
      turns,
    }),
    output: z.object({ output: z.string().nullable() }),
  },
});
