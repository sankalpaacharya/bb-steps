<p align="center">
  <img src="assets/logo.svg" width="112" alt="Steps logo" />
</p>

<h1 align="center">Steps</h1>

<p align="center"><strong>See what your agents did and where the time went, inside BB.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/BB-0.49%2B-34c88a" alt="Requires BB 0.49 or later" />
  <img src="https://img.shields.io/badge/view-waterfall-lightgrey" alt="Waterfall timeline" />
</p>

<p align="center">
  <img src="assets/showcase.png" width="1000" alt="Steps showing a list of messages and one message's waterfall, with time spent reading, writing, running and thinking" />
</p>

BB shows an agent's work as one long chat. Steps adds a side panel tab that lays out each of your messages as a waterfall, with every file read, command, edit, web fetch and subagent on one timeline.

## Install

```sh
bb plugin install git:https://github.com/sankalpaacharya/bb-steps.git@main
```

Then open a thread, press **⌘J**, click **+**, and choose **Steps**. Requires BB 0.49+.

## What you get

- A list of your messages, grouped by day. Pick one to open its waterfall
- Total time for each message, and how much went on reading, writing, running and thinking, updating live
- Every step on one timeline with its own duration, and a shimmer on the one still running
- Input and output for each step, and **Open file** for files it touched
- Threads a message started, such as a captain's workers, on the same timeline and opening in place
- **All threads** at the top of the list, with every thread this one started, whichever message started it

Click **Reading**, **Writing** or any other total to list only those steps. Drag the sidebar's edge to resize it, or use its panel icon to collapse it.

BB doesn't keep the output of file reads or web fetches, so those steps show their input only.

## Dev

```sh
npm install
npm run check
bb plugin install . --yes
```

`npm run check` runs the typecheck, the tests and the build.
