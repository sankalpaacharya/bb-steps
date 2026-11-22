import { createAvatar } from "@dicebear/core";
import * as micah from "@dicebear/micah";

const BACKGROUNDS = ["b6e3f4", "c0aede", "d1d4f9", "ffd5dc", "ffdfbf", "c1f4c5"];

const rendered = new Map<string, string>();

/** A captain's face as Armada draws it, generated once per seed. */
export function faceOf(seed: string): string {
  let uri = rendered.get(seed);
  if (uri === undefined) {
    uri = createAvatar(micah, {
      seed,
      backgroundColor: BACKGROUNDS,
      backgroundType: ["solid"],
    }).toDataUri();
    rendered.set(seed, uri);
  }
  return uri;
}
