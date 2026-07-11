import json

from hypothesis import given
from hypothesis import strategies as st

from tracelabel.ctf import canonical_json, content_hash, derive_trace_id, serialize_content

# JSON-ish dicts with unicode string keys/values.
_json_scalars = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(),
    st.text(),
)
_json_values = st.recursive(
    _json_scalars,
    lambda children: st.one_of(
        st.lists(children, max_size=4),
        st.dictionaries(st.text(), children, max_size=4),
    ),
    max_leaves=15,
)
_json_dicts = st.dictionaries(st.text(), _json_values, max_size=6)


def _shuffle_keys(x):
    # Rebuild the structure with keys re-inserted in reversed order — content identical,
    # insertion order different.
    if isinstance(x, dict):
        return {k: _shuffle_keys(x[k]) for k in reversed(list(x.keys()))}
    if isinstance(x, list):
        return [_shuffle_keys(v) for v in x]
    return x


# --- CAN-01 ------------------------------------------------------------------


@given(_json_dicts)
def test_canonical_json_key_order_invariant(d):
    reordered = _shuffle_keys(d)
    assert canonical_json(d) == canonical_json(reordered)
    # And the canonical form is valid JSON encoding the same data.
    assert json.loads(canonical_json(d)) == d


# --- CAN-02 ------------------------------------------------------------------


@given(st.lists(_json_dicts, min_size=1, max_size=4))
def test_content_hash_stable(messages):
    reordered = _shuffle_keys(messages)
    assert content_hash(messages) == content_hash(reordered)
    assert derive_trace_id(messages) == derive_trace_id(reordered)


# --- CAN-03 ------------------------------------------------------------------


@given(st.text())
def test_serialize_content_verbatim_strings(s):
    # Whitespace-significant strings must survive byte-for-byte (invariant #1).
    assert serialize_content(s) == s
