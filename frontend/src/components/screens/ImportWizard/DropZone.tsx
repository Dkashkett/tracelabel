// A drop zone / file picker that reads the dropped or selected file's text into a
// plain string via the browser File/FileReader API. There is no server-side
// file-path access from a browser for a dropped file (the browser only exposes a
// File object, never an absolute path) — so this is purely a `content` source. A
// server-local `path` is handled separately, by a plain text input (see index.tsx).
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CheckIcon, UploadIcon } from "@/components/ui/icons";

export function DropZone({
  onFileText,
  fileName,
}: {
  onFileText: (text: string, name: string) => void;
  fileName: string | null;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const readFile = async (file: File) => {
    const text = await file.text();
    onFileText(text, file.name);
  };

  return (
    <div
      data-testid="drop-zone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "group flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-inset/35 px-5 py-8 text-center text-sm text-ink-muted outline-none transition-all hover:border-accent/50 hover:bg-accent/[0.035]",
        dragging && "scale-[1.005] border-accent bg-accent/[0.07] text-ink shadow-glow",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void readFile(file);
        }}
      />
      <span
        className={cn(
          "grid h-11 w-11 place-items-center rounded-xl border transition-colors",
          fileName
            ? "border-pass/30 bg-pass/10 text-pass"
            : "border-line-strong bg-surface-raised text-ink-muted group-hover:border-accent/35 group-hover:text-accent-strong",
        )}
      >
        {fileName ? <CheckIcon className="h-5 w-5" /> : <UploadIcon className="h-5 w-5" />}
      </span>
      <span className="font-medium text-ink">
        {fileName ? fileName : "Drop a trace file here"}
      </span>
      <span className="text-xs text-ink-muted">
        {fileName ? "Ready to preview" : "or click to choose from this machine"}
      </span>
    </div>
  );
}
