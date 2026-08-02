// `engine-core`, per tools/engine-layers.mjs — the single source of truth for
// layering. This said "engine-text", which is not a layer, and the boundary
// test has been red since the T1 spike landed. A guardrail that is red by
// default is a guardrail nobody reads.
export const ENGINE_PACKAGE = { name: "@bracketx/engine-text", layer: "engine-core" } as const;
