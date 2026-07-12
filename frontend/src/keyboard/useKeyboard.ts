import { useEffect, useRef } from "react";
import { useController, type Controller } from "@/state/NavContext";
import { isSelect, primarySelect } from "@/state/navReducer";
import type { ResolvedField } from "@/api/types";

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "TEXTAREA" || tag === "INPUT" || (el as HTMLElement).isContentEditable;
}

function focusedField(ctl: Controller, el: Element | null): ResolvedField | null {
  const name = el?.closest("[data-field-name]")?.getAttribute("data-field-name");
  if (!name) return null;
  return ctl.session.fields.find((f) => f.name === name && isSelect(f)) ?? null;
}

function applyDigit(ctl: Controller, n: number, el: Element | null) {
  // digits act on the focused select if one is focused, else the primary select (06 §2.1)
  const field = focusedField(ctl, el) ?? primarySelect(ctl.session.fields);
  if (!field || !field.options) return;
  const option = field.options[n - 1];
  if (option === undefined) return;
  if (field.type === "single_select") ctl.setField(field.name, option);
  else ctl.toggleMulti(field.name, option);
}

function cycleFields(ctl: Controller, backwards: boolean) {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-form-control]"));
  if (!nodes.length) return;
  const active = document.activeElement;
  const cur = nodes.findIndex((n) => n === active || n.contains(active));
  const next =
    cur === -1
      ? backwards
        ? nodes.length - 1
        : 0
      : (cur + (backwards ? -1 : 1) + nodes.length) % nodes.length;
  nodes[next].focus();
  ctl.dispatch({ type: "SET_MODE", mode: "FIELD" });
}

function handleKeyDown(e: KeyboardEvent, ctl: Controller) {
  if (e.isComposing) return; // never intercept an IME composition (06 §2)
  const el = document.activeElement;
  const inText = isTextInput(el);

  if (e.key === "?" && !inText) {
    e.preventDefault();
    ctl.setCheatOpen(!ctl.cheatOpen);
    return;
  }

  if (e.key === "Escape") {
    if (ctl.cheatOpen) {
      ctl.setCheatOpen(false);
      return;
    }
    if (inText || ctl.state.mode === "FIELD") {
      (el as HTMLElement | null)?.blur?.();
      ctl.dispatch({ type: "SET_MODE", mode: "NAV" });
    }
    return;
  }

  // FIELD typing: only Cmd/Ctrl+Enter is intercepted (commit); everything else types (06 §2).
  if (inText) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      ctl.commit();
    }
    return;
  }

  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser/OS shortcuts alone

  if (/^[1-9]$/.test(e.key)) {
    applyDigit(ctl, Number(e.key), el);
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case "j":
      ctl.nextTurn();
      e.preventDefault();
      break;
    case "k":
      ctl.prevTurn();
      e.preventDefault();
      break;
    case "n":
      ctl.nextTrace();
      e.preventDefault();
      break;
    case "p":
      ctl.prevTrace();
      e.preventDefault();
      break;
    case "Enter":
      ctl.commit();
      e.preventDefault();
      break;
    case "r":
      ctl.focusFirstText();
      e.preventDefault();
      break;
    case "s":
      ctl.skip();
      e.preventDefault();
      break;
    case "u":
      ctl.prevTarget();
      e.preventDefault();
      break;
    case "v":
      if (!e.repeat) ctl.setPeek(true);
      break;
    case "Tab":
      cycleFields(ctl, e.shiftKey);
      e.preventDefault();
      break;
  }
}

function handleKeyUp(e: KeyboardEvent, ctl: Controller) {
  if (e.key === "v") ctl.setPeek(false);
}

export function useKeyboard() {
  const ctl = useController();
  const ref = useRef(ctl);
  ref.current = ctl;
  useEffect(() => {
    const down = (e: KeyboardEvent) => handleKeyDown(e, ref.current);
    const up = (e: KeyboardEvent) => handleKeyUp(e, ref.current);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
