import { definePluginApp } from "@get-bb/plugin-sdk/app";

import { StepsTab } from "./components/steps-tab";
import { WaterfallIcon } from "./components/waterfall-icon";

export default definePluginApp((app) => {
  app.experimental_icons.register({
    name: "steps-waterfall",
    component: WaterfallIcon,
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "steps",
    title: "Steps",
    tooltip: "Where this thread's time went",
    icon: "steps-waterfall",
    layout: "flush",
    component: StepsTab,
  });
});
