import { describe, expect, it } from "vitest";
import { checkFrameApp, checkFrameViews } from "@termix-ssh/plugin-sdk/testing";
import manifest from "../../manifest.json";
import * as plugin from "../../src/frontend";

/**
 * Plugin API 2 runs a community plugin's frontend in sandboxed frames. These
 * checks run activate and the panel the way a frame does and fail on
 * anything the shell would refuse there.
 */
describe("in a frame", () => {
  it("registers only what a frame may register", async () => {
    const { problems } = await checkFrameApp(plugin, { manifest });
    expect(problems).toEqual([]);
  });

  it("asks core only for what a frame may reach", async () => {
    const { refused } = await checkFrameViews(plugin, { manifest, hosts: [] });
    expect(refused).toEqual([]);
  });
});
