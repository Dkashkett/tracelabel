import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SchemaOut } from "@/api/types";
import { SchemaImpactError } from "@/api/client/schema";
import RubricEditor from "./index";

const apiMock = vi.hoisted(() => ({
  schemaApi: {
    getSchema: vi.fn(),
    patchSchema: vi.fn(),
  },
  tasksApi: {
    createTask: vi.fn(),
  },
}));

vi.mock("@/api/client", () => ({
  schemaApi: apiMock.schemaApi,
  tasksApi: apiMock.tasksApi,
}));

const schema: SchemaOut = {
  fields: [
    { name: "verdict", label: "Verdict", type: "single_select", options: ["pass", "fail"], required: true },
  ],
  schema_hash: "sha256:a",
  compat_hash: "sha256:b",
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:project/t/:task/schema" element={<RubricEditor />} />
          <Route path="/p/:project" element={<div>project screen</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RubricEditor", () => {
  it("renders the current fields and a live preview", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    renderAt("/p/support-triage/t/escalation-risk/schema");

    expect(await screen.findAllByDisplayValue("verdict")).toHaveLength(1);
    expect(screen.getAllByText("pass").length).toBeGreaterThan(0);
  });

  it("adds and removes a field", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    renderAt("/p/support-triage/t/escalation-risk/schema");
    await screen.findAllByDisplayValue("verdict");

    fireEvent.click(screen.getByText("Add field"));
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove field 2" }));
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(1);
  });

  it("applies a preset, replacing the current fields", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    renderAt("/p/support-triage/t/escalation-risk/schema");
    await screen.findAllByDisplayValue("verdict");

    fireEvent.click(screen.getByText("Add field"));
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(2);

    fireEvent.click(screen.getByText("Pass / fail"));
    expect(screen.getByRole("dialog", { name: "Replace the current rubric?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply preset" }));
    expect(await screen.findAllByDisplayValue("reasoning")).toHaveLength(1);
    expect(screen.getAllByPlaceholderText("field_name")).toHaveLength(2);
  });

  it("saves non-breaking changes", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    apiMock.schemaApi.patchSchema.mockResolvedValue(schema);
    renderAt("/p/support-triage/t/escalation-risk/schema");
    await screen.findAllByDisplayValue("verdict");

    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(apiMock.schemaApi.patchSchema).toHaveBeenCalledWith(
      "support-triage",
      "escalation-risk",
      { fields: schema.fields },
      false,
    );
    // Save alone stays on the rubric editor.
    expect(screen.queryByText("project screen")).toBeNull();
  });

  it("Done saves and returns to the project screen", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    apiMock.schemaApi.patchSchema.mockResolvedValue(schema);
    renderAt("/p/support-triage/t/escalation-risk/schema");
    await screen.findAllByDisplayValue("verdict");

    fireEvent.click(screen.getByText("Done"));

    expect(await screen.findByText("project screen")).toBeTruthy();
    expect(apiMock.schemaApi.patchSchema).toHaveBeenCalledWith(
      "support-triage",
      "escalation-risk",
      { fields: schema.fields },
      false,
    );
  });

  it("shows the breaking-change dialog and re-submits with confirm on 'Remove anyway'", async () => {
    apiMock.schemaApi.getSchema.mockResolvedValue(schema);
    const impact = {
      removed_fields: ["verdict"],
      retyped_fields: [],
      removed_options: {},
      affected_annotations: 47,
      breaking: true,
    };
    apiMock.schemaApi.patchSchema
      .mockRejectedValueOnce(new SchemaImpactError(impact))
      .mockResolvedValueOnce({ ...schema, fields: [] });

    renderAt("/p/support-triage/t/escalation-risk/schema");
    await screen.findAllByDisplayValue("verdict");

    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText("47 annotations would be affected.")).toBeTruthy();

    fireEvent.click(screen.getByText("Remove anyway"));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(apiMock.schemaApi.patchSchema).toHaveBeenLastCalledWith(
      "support-triage",
      "escalation-risk",
      { fields: schema.fields },
      true,
    );
  });
});
