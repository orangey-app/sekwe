import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN } from "../../src/lib/prefs.ts";

test("the side panel's width stays sensible for the window", () => {
  assert.equal(clampPanelWidth(400, 1600), 400);
  assert.equal(clampPanelWidth(10, 1600), PANEL_MIN);
  assert.equal(clampPanelWidth(5000, 3000), PANEL_MAX);
  // Never more than 60% of the window, so the page keeps room.
  assert.equal(clampPanelWidth(800, 1000), 600);
  // A tiny window still gets the narrowest panel, not a smaller one.
  assert.equal(clampPanelWidth(300, 300), PANEL_MIN);
  assert.equal(clampPanelWidth(Number.NaN, 1600), PANEL_DEFAULT);
});
