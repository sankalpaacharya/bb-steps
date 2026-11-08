import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { StepsTab } from "./components/steps-tab";

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "steps",
    title: "Steps",
    tooltip: "Where this thread's time went",
    icon: "Clock",
    layout: "flush",
    component: StepsTab,
  });
});
