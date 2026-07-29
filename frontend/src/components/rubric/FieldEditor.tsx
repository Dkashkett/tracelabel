import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FieldDef, FieldType } from "@/api/types";

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export interface FieldEditorProps {
  field: FieldDef;
  onChange: (field: FieldDef) => void;
  onRemove: () => void;
}

// One editable row in the rubric form builder: name/label/type/options/required/
// placeholder/help for a single FieldDef.
export function FieldEditor({ field, onChange, onRemove }: FieldEditorProps) {
  const nameValid = NAME_PATTERN.test(field.name);
  const isSelect = field.type === "single_select" || field.type === "multi_select";

  function setOption(index: number, value: string) {
    const options = [...(field.options ?? [])];
    options[index] = value;
    onChange({ ...field, options });
  }

  function addOption() {
    onChange({ ...field, options: [...(field.options ?? []), ""] });
  }

  function removeOption(index: number) {
    onChange({ ...field, options: (field.options ?? []).filter((_, i) => i !== index) });
  }

  return (
    <div className="rounded-lg border border-line bg-surface-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          size="sm"
          className="w-40 shrink-0"
          value={field.name}
          onChange={(event) => onChange({ ...field, name: event.target.value })}
          placeholder="field_name"
        />
        <Input
          size="sm"
          className="min-w-[10rem] flex-1"
          value={field.label ?? ""}
          onChange={(event) => onChange({ ...field, label: event.target.value })}
          placeholder="Label"
        />
        <select
          className="rounded-lg border border-line bg-transparent px-2 py-1 text-sm text-ink"
          value={field.type}
          onChange={(event) => onChange({ ...field, type: event.target.value as FieldType })}
        >
          <option value="text">Text</option>
          <option value="single_select">Single select</option>
          <option value="multi_select">Multi select</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onChange({ ...field, required: event.target.checked })}
          />
          Required
        </label>
        <Button variant="ghost" type="button" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {!nameValid && (
        <p className="mt-1 text-xs text-fail">
          Name must be lowercase letters, numbers, or underscores, starting with a letter.
        </p>
      )}

      {isSelect && (
        <div className="mt-2 flex flex-col gap-1">
          {(field.options ?? []).map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                size="sm"
                className="w-40"
                value={option}
                onChange={(event) => setOption(index, event.target.value)}
              />
              <Button variant="ghost" type="button" onClick={() => removeOption(index)}>
                ✕
              </Button>
            </div>
          ))}
          <Button variant="outline" type="button" onClick={addOption} className="w-fit">
            Add option
          </Button>
        </div>
      )}

      {field.type === "text" && (
        <Input
          size="sm"
          className="mt-2"
          value={field.placeholder ?? ""}
          onChange={(event) => onChange({ ...field, placeholder: event.target.value })}
          placeholder="Placeholder text"
        />
      )}

      <Input
        size="sm"
        className="mt-2"
        value={field.help ?? ""}
        onChange={(event) => onChange({ ...field, help: event.target.value })}
        placeholder="Help text (optional)"
      />
    </div>
  );
}
