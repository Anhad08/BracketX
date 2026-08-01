/**
 * Scene registration.
 *
 * Every showcase scene is imported here for its side effect. Nothing else in
 * the application knows the scene set exists — the shell reads the registry.
 *
 * Phase 1 deliberately ships no scenes. The shell is the subsystem under
 * construction, and an empty registry is a real state it must handle: the
 * sidebar says so rather than crashing, which is exactly what a contributor
 * adding the first scene will see.
 */
export {};
