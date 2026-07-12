import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResolvedField } from "../api/types";
import { FieldRenderer } from "./FieldRenderer";
import { HtmlFrame } from "./renderers/HtmlFrame";

const noop = () => {};

describe("FieldRenderer (06 §6 switch)", () => {
  it("renders a single_select as a radiogroup with numbered hotkeys", () => {
    const f: ResolvedField = {
      name: "verdict",
      label: "Verdict",
      type: "single_select",
      required: true,
      options: ["pass", "fail"],
    };
    render(<FieldRenderer field={f} value="pass" setValue={noop} toggle={noop} />);
    const group = screen.getByRole("radiogroup");
    expect(group.getAttribute("data-field-name")).toBe("verdict");
    expect(screen.getByRole("radio", { name: /pass/ })).toHaveProperty("ariaChecked", "true");
    expect(screen.getAllByText("1")[0]).toBeTruthy();
  });

  it("renders a multi_select as checkboxes", () => {
    const f: ResolvedField = {
      name: "modes",
      label: "Modes",
      type: "multi_select",
      required: false,
      options: ["a", "b"],
    };
    render(<FieldRenderer field={f} value={["b"]} setValue={noop} toggle={noop} />);
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toHaveProperty("ariaChecked", "true");
  });

  it("renders a text field as a textarea", () => {
    const f: ResolvedField = {
      name: "why",
      label: "Why",
      type: "text",
      required: false,
      placeholder: "notes…",
    };
    render(<FieldRenderer field={f} value="hello" setValue={noop} toggle={noop} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.value).toBe("hello");
  });
});

describe("HtmlFrame security (06 §4)", () => {
  it("renders untrusted html through an iframe with an empty sandbox attr", () => {
    const { container } = render(
      <HtmlFrame content="<script>window.__pwned = true;</script><b>hi</b>" />,
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("sandbox")).toBe("");
    // scripts inside an empty-sandbox iframe cannot execute
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
