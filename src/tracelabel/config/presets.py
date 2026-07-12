from .models import FieldDef, PresetRef

DEFAULT_FIELDS = [
    FieldDef(
        name="verdict",
        label="Verdict",
        type="single_select",
        options=["pass", "fail"],
        required=True,
    ),
    FieldDef(
        name="reasoning",
        label="Reasoning",
        type="text",
        placeholder="Why is this a pass or fail?",
    ),
]

PRESETS = {"pass_fail": DEFAULT_FIELDS}


def expand_presets(items: list[PresetRef | FieldDef]) -> list[FieldDef]:
    fields: list[FieldDef] = []
    for item in items:
        if isinstance(item, PresetRef):
            fields.extend(PRESETS[item.preset])
        else:
            fields.append(item)
    return fields
