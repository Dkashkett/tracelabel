// A drop zone / file picker that reads the dropped or selected file's text into a
// plain string via the browser File/FileReader API. There is no server-side
// file-path access from a browser for a dropped file (the browser only exposes a
// File object, never an absolute path) — so this is purely a `content` source. A
// server-local `path` is handled separately, by a plain text input (see index.tsx).
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
        "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted transition-colors",
        dragging && "border-accent bg-accent/5 text-ink",
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
      <span>Drop a trace file here, or click to choose one</span>
      {fileName && <span className="text-xs text-ink-faint">Loaded: {fileName}</span>}
    </div>
  );
}
