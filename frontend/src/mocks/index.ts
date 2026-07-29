// Barrel re-export of every mock domain module. api/client/index.ts imports domain
// mock implementations directly from their own files; this barrel exists for
// convenience (tests, storybook-style exploration) and to keep one canonical list of
// what mock data exists.
export * as settingsMocks from "./settings";
export * as projectsMocks from "./projects";
export * as importsMocks from "./imports";
export * as tasksMocks from "./tasks";
export * as labelingMocks from "./labeling";
