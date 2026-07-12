import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders a heading and a list", () => {
    render(<MarkdownContent content={"# Title\n\n- one\n- two\n"} />);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items.map((el) => el.textContent)).toEqual(["one", "two"]);
  });

  it("renders GFM tables via remark-gfm", () => {
    const table = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    render(<MarkdownContent content={table} />);
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("never renders an embedded <script> tag as live markup", () => {
    render(<MarkdownContent content={"hi <script>window.__pwned = true;</script> there"} />);
    expect(document.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
