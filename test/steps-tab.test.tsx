// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";

import { StepsTab } from "../components/steps-tab";
import { buildThreadSteps, focusTurn, type ThreadSteps } from "../lib/steps";
import { thread } from "./fixtures";
import { at, command, prompt, reply, thought, work } from "./timeline-rows";

afterEach(cleanup);

const rows = [
  prompt("t1", 0, "first, look around"),
  command("t1", 1, 3, "ls"),
  reply("t1", 4),
  prompt("t2", 100, "make the tab"),
  work("t2", 101, 102, "file-read", { path: "/repo/lib/forest.ts" }),
  command("t2", 103, 143, "cd /repo && npm run check"),
  thought("t2", 145, 153, "Checking what the failing test expects."),
  work("t2", 154, 155, "file-change", {
    change: { path: "/repo/lib/forest.ts", kind: "update" },
  }),
  reply("t2", 160),
];

const ready = (): ThreadSteps =>
  buildThreadSteps(rows, {
    threadId: "thr",
    running: false,
    now: at(1000),
    hasOlder: false,
  });

function renderSteps(steps: () => ThreadSteps) {
  const reads: unknown[] = [];
  const view = renderSlot(
    { component: StepsTab },
    { threadId: "thr", environment: null, params: null },
    {
      sidebarThreads: {
        status: "ready",
        threads: [thread("thr", { host: { id: "host_mac", name: "MacBook" } })],
        projects: [],
        sections: [],
      },
      rpc: {
        thread_steps: (input: { turnId: string | null; turns: number }) => {
          reads.push(input);
          return focusTurn(steps(), input.turnId, input.turns);
        },
        step_output: () => ({ output: "3 passed" }),
      } as never,
    },
  );
  return { view, reads };
}

/** The open turn's rows, by name, top to bottom. */
const shownSteps = () =>
  Array.from(document.querySelectorAll("li[data-step]")).map(
    (item) => item.querySelector("button .truncate")?.textContent,
  );

describe("the steps tab", () => {
  it("opens the newest turn on its waterfall and a legend of where its time went, biggest first", async () => {
    const { reads } = renderSteps(ready);
    expect(await screen.findByRole("group", { name: "Show one kind" })).toBeTruthy();
    const legend = screen.getByRole("group", { name: "Show one kind" });
    expect(
      within(legend)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Running40s", "Thinking18s", "Reading1s", "Editing1s"]);
    expect(reads).toContainEqual({ threadId: "thr", turns: 10, turnId: null });
    expect(shownSteps()).toEqual([
      "forest.ts",
      "npm run check",
      "forest.ts",
    ]);
    expect(
      within(screen.getByRole("navigation", { name: "Messages" }))
        .getAllByRole("button")
        .map((row) => row.getAttribute("aria-current")),
    ).toEqual(["true", null]);
  });

  it("shows only one kind while its chip is pressed", async () => {
    renderSteps(ready);
    const reading = await screen.findByRole("button", { name: /^Reading/ });
    fireEvent.click(reading);
    expect(reading.getAttribute("aria-pressed")).toBe("true");
    expect(shownSteps()).toEqual(["forest.ts"]);
    fireEvent.click(reading);
    expect(shownSteps()).toHaveLength(3);
  });

  it("opens a step to its full command, and a read file in bb's preview", async () => {
    const { view } = renderSteps(ready);
    fireEvent.click((await screen.findByText("npm run check")).closest("button")!);
    expect(await screen.findByText("cd /repo && npm run check")).toBeTruthy();
    expect(await screen.findByText("3 passed")).toBeTruthy();
    fireEvent.click(screen.getAllByText("forest.ts")[0]!.closest("button")!);
    fireEvent.click(await screen.findByRole("button", { name: "Open file" }));
    expect(view.inspection.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: {
        target: { kind: "host", hostId: "host_mac", path: "/repo/lib/forest.ts" },
        location: null,
      },
    });
  });

  it("opens a message's waterfall when it is picked in the list", async () => {
    const { reads } = renderSteps(ready);
    fireEvent.click(
      await screen.findByRole("button", { name: /first, look around/ }),
    );
    expect(await screen.findByText("ls")).toBeTruthy();
    expect(reads).toContainEqual({
      threadId: "thr",
      turns: 10,
      turnId: expect.stringContaining("t1"),
    });
  });

  it("reads older messages by itself when the end of the list comes into view", async () => {
    let reveal: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof reveal) {
          reveal = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const { reads } = renderSteps(() => ({ ...ready(), hasOlder: true }));
    await screen.findByRole("group", { name: "Show one kind" });
    act(() => reveal([{ isIntersecting: true }]));
    await waitFor(() =>
      expect(reads).toContainEqual({ threadId: "thr", turns: 20, turnId: null }),
    );
    expect(screen.queryByRole("button", { name: "Show older turns" })).toBeNull();
    vi.unstubAllGlobals();
  });

  it("resizes the message sidebar from its edge, and double-click resets it", async () => {
    renderSteps(ready);
    const edge = await screen.findByRole("separator", { name: "Resize messages" });
    const before = Number(edge.getAttribute("aria-valuenow"));
    fireEvent.keyDown(edge, { key: "ArrowRight" });
    expect(Number(edge.getAttribute("aria-valuenow"))).toBe(before + 24);
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    fireEvent.keyDown(edge, { key: "ArrowLeft" });
    expect(Number(edge.getAttribute("aria-valuenow"))).toBe(before - 24);
    fireEvent.doubleClick(edge);
    expect(Number(edge.getAttribute("aria-valuenow"))).toBe(before);
  });

  it("times a folded row by its steps, without the gaps between them", async () => {
    renderSteps(() =>
      buildThreadSteps(
        [
          prompt("t1", 0, "look"),
          work("t1", 1, 2, "file-read", { path: "/repo/a.ts" }),
          work("t1", 12, 13, "file-read", { path: "/repo/b.ts" }),
          work("t1", 23, 24, "file-read", { path: "/repo/c.ts" }),
          reply("t1", 30),
        ],
        { threadId: "thr", running: false, now: at(1000), hasOlder: false },
      ),
    );
    const row = (await screen.findByText("Read 3 files")).closest("button")!;
    expect(within(row).getByText("3s")).toBeTruthy();
  });

  it("hides the message sidebar and brings it back", async () => {
    renderSteps(ready);
    fireEvent.click(await screen.findByRole("button", { name: "Hide messages" }));
    expect(screen.queryByRole("navigation", { name: "Messages" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show messages" }));
    expect(screen.getByRole("navigation", { name: "Messages" })).toBeTruthy();
  });

  it("moves through the messages with the arrow keys", async () => {
    const { reads } = renderSteps(ready);
    const list = await screen.findByRole("navigation", { name: "Messages" });
    const [newest] = within(list).getAllByRole("button");
    newest!.focus();
    fireEvent.keyDown(newest!, { key: "ArrowDown" });
    await waitFor(() =>
      expect(reads).toContainEqual({
        threadId: "thr",
        turns: 10,
        turnId: expect.stringContaining("t1"),
      }),
    );
  });

  it("lists a message by its own words, without the skill in front", async () => {
    renderSteps(() =>
      buildThreadSteps(
        [prompt("t1", 0, "/pstack:unslop tidy this"), reply("t1", 5)],
        { threadId: "thr", running: false, now: at(1000), hasOlder: false },
      ),
    );
    const list = await screen.findByRole("navigation", { name: "Messages" });
    expect(within(list).getByText("tidy this")).toBeTruthy();
    expect(within(list).queryByText(/unslop/)).toBeNull();
  });

  it("keeps thinking out of the steps until Thinking is picked", async () => {
    renderSteps(ready);
    await screen.findByRole("group", { name: "Show one kind" });
    expect(shownSteps()).not.toContain("Thought");
    fireEvent.click(screen.getByRole("button", { name: /^Thinking/ }));
    expect(shownSteps()).toEqual(["Thought"]);
  });

  it("says when there are no steps yet", async () => {
    renderSteps(() => ({ ...ready(), turns: [] }));
    expect(
      await screen.findByText("No steps yet. They show here as the agent works."),
    ).toBeTruthy();
  });

  it("says what failed, and reads again on Retry", async () => {
    let fail = true;
    const { reads } = renderSteps(() => {
      if (fail) throw new Error("thread not found");
      return ready();
    });
    expect(await screen.findByText(/thread not found/)).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("group", { name: "Show one kind" })).toBeTruthy();
    expect(reads.length).toBeGreaterThan(1);
  });
});
