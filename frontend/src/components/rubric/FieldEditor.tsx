import { useId } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import type { FieldDef, FieldType } from "@/api/types";

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface FieldEditorProps {
  field: FieldDef;
  index: number;
  onChange: (field: FieldDef) => void;
  onRemove: () => void;
}

export function FieldEditor({ field, index, onChange, onRemove }: FieldEditorProps) {
  const id = useId();
  const nameValid = NAME_PATTERN.test(field.name);
  const isSelect = field.type === "single_select" || field.type === "multi_select";

  function setOption(optionIndex: number, value: string) {
    const options = [...(field.options ?? [])];
    options[optionIndex] = value;
    onChange({ ...field, options });
  }

  function addOption() {
    onChange({ ...field, options: [...(field.options ?? []), ""] });
  }

  function removeOption(optionIndex: number) {
    onChange({
      ...field,
      options: (field.options ?? []).filter((_, current) => current !== optionIndex),
    });
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-line-strong/70 bg-surface-raised/65 shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-inset/30 px-4 py-3">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">
          Field {String(index + 1).padStart(2, "0")}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(event) => onChange({ ...field, required: event.target.checked })}
            />
            Required
          </label>
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label={`Remove field ${index + 1}`}
            title="Remove field"
            className="h-8 w-8 text-ink-faint hover:bg-fail/10 hover:text-fail"
            onClick={onRemove}
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="space-y-5 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor={`${id}-name`}>
            <span className="text-[11px] font-semibold text-ink">Field key</span>
            <Input
              id={`${id}-name`}
              size="sm"
              className="mt-1.5 font-mono text-xs"
              value={field.name}
              onChange={(event) => onChange({ ...field, name: event.target.value })}
              placeholder="field_name"
              aria-invalid={!nameValid}
              aria-describedby={!nameValid ? `${id}-name-error` : undefined}
            />
          </label>
          <label className="block" htmlFor={`${id}-label`}>
            <span className="text-[11px] font-semibold text-ink">Display label</span>
            <Input
              id={`${id}-label`}
              size="sm"
              className="mt-1.5"
              value={field.label ?? ""}
              onChange={(event) => onChange({ ...field, label: event.target.value })}
              placeholder="Label shown to annotators"
            />
          </label>
        </div>

        {!nameValid && (
          <p id={`${id}-name-error`} className="-mt-2 text-xs leading-5 text-fail">
            Use lowercase letters, numbers, or underscores and start with a letter.
          </p>
        )}

        <label className="block" htmlFor={`${id}-type`}>
          <span className="text-[11px] font-semibold text-ink">Response type</span>
          <select
            id={`${id}-type`}
            className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface-inset/55 px-3 py-2 text-sm text-ink outline-none transition-all hover:border-ink-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
            value={field.type}
            onChange={(event) =>
              onChange({ ...field, type: event.target.value as FieldType })
            }
          >
            <option value="text">Freeform text</option>
            <option value="single_select">Single select</option>
            <option value="multi_select">Multi select</option>
          </select>
        </label>

        {isSelect && (
          <fieldset>
            <legend className="text-[11px] font-semibold text-ink">Options</legend>
            <div className="mt-2 space-y-2">
              {(field.options ?? []).map((option, optionIndex) => (
                <div key={optionIndex} className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-inset font-mono text-[10px] text-ink-faint">
                    {optionIndex + 1}
                  </span>
                  <Input
                    size="sm"
                    value={option}
                    onChange={(event) => setOption(optionIndex, event.target.value)}
                    placeholder={`Option ${optionIndex + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    aria-label={`Remove option ${optionIndex + 1}`}
                    className="h-8 w-8"
                    onClick={() => removeOption(optionIndex)}
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" type="button" onClick={addOption} className="mt-2">
              <PlusIcon className="h-3.5 w-3.5" />
              Add option
            </Button>
          </fieldset>
        )}

        {field.type === "text" && (
          <label className="block" htmlFor={`${id}-placeholder`}>
            <span className="text-[11px] font-semibold text-ink">Placeholder</span>
            <Input
              id={`${id}-placeholder`}
              size="sm"
              className="mt-1.5"
              value={field.placeholder ?? ""}
              onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
              placeholder="Prompt shown inside the response field"
            />
          </label>
        )}

        <label className="block" htmlFor={`${id}-help`}>
          <span className="text-[11px] font-semibold text-ink">
            Help text <span className="font-normal text-ink-faint">optional</span>
          </span>
          <Input
            id={`${id}-help`}
            size="sm"
            className="mt-1.5"
            value={field.help ?? ""}
            onChange={(event) => onChange({ ...field, help: event.target.value })}
            placeholder="Give annotators additional guidance"
          />
        </label>
      </div>
    </article>
  );
}
