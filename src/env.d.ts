declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<Record<string, unknown>>;
  export default component;
}

/** Stylesheets are imported for their side effect; Vite bundles them. */
declare module "*.css";
