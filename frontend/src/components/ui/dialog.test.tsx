import { useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

function DialogHarness({ onChange = vi.fn() }: { onChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button">Before dialog</button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          onChange(next);
          setOpen(next);
        }}
        title="Accessible dialog"
        description="Dialog description"
        initialFocusRef={inputRef}
        footer={<button type="button">Last action</button>}
      >
        <input ref={inputRef} aria-label="First field" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("labels the modal, focuses its initial control, and closes on Escape", async () => {
    const onChange = vi.fn();
    render(<DialogHarness onChange={onChange} />);

    expect(screen.getByRole("dialog", { name: "Accessible dialog" })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("First field")).toBe(document.activeElement));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the named close control", () => {
    const onChange = vi.fn();
    render(<DialogHarness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
