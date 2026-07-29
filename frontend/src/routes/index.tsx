import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import DataManager from "@/components/screens/DataManager";
import ImportWizard from "@/components/screens/ImportWizard";
import LabelView from "@/components/screens/LabelView";
import NewTask from "@/components/screens/NewTask";
import ProjectHome from "@/components/screens/ProjectHome";
import ProjectList from "@/components/screens/ProjectList";
import Results from "@/components/screens/Results";
import RubricEditor from "@/components/screens/RubricEditor";
import Settings from "@/components/screens/Settings";

// The full route table (docs/refactor-plan.md §4 F1-SHELL). LabelView is the only real
// screen this wave; every other screen is a placeholder for the F2-* packets to fill
// in without touching this file.
//
// LabelView is registered outside the AppShell layout route: it ships its own
// full-height Header (progress bar, back button, shortcuts), so nesting it under
// AppShell's top bar would just double the chrome.
// Exported as a plain array (not just the browser router built from it) so tests can
// feed the same route tree into a createMemoryRouter — see routes/index.test.tsx.
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <ProjectList /> },
      { path: "/p/:project", element: <ProjectHome /> },
      { path: "/p/:project/tasks/new", element: <NewTask /> },
      { path: "/p/:project/import", element: <ImportWizard /> },
      { path: "/p/:project/t/:task/schema", element: <RubricEditor /> },
      { path: "/p/:project/t/:task/items", element: <DataManager /> },
      { path: "/p/:project/t/:task/results", element: <Results /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
  { path: "/p/:project/t/:task/label", element: <LabelView /> },
  { path: "/p/:project/t/:task/label/:trace", element: <LabelView /> },
];

export const router = createBrowserRouter(routes);
