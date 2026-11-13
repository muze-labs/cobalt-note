/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
    edit, RICH_TEXT_NOTE_CHANGE_EVENT,
    type Editor, type Fragment, type RichTextNoteChangeDetail
} from "../src/index.js";

const editors: Editor[] = [];
afterEach(() => {
    for (const editor of editors.splice(0)) {
        editor.destroy();
    }
    document.body.replaceChildren();
});

function setup(fragment: Fragment = { text: "Hello world", annotations: [] }) {
    const element = document.createElement("div");
    document.body.append(element);
    const changes: Fragment[] = [];
    element.addEventListener(RICH_TEXT_NOTE_CHANGE_EVENT, event => {
        changes.push((event as CustomEvent<RichTextNoteChangeDetail>).detail.fragment);
    });
    const editor = edit(element, fragment);
    editors.push(editor);
    return { element, editor, changes };
}
function compose(element: HTMLElement, type: string, data = "") {
    element.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
}
function provisional(element: HTMLElement, text: string, data: string) {
    compose(element, "compositionupdate", data);
    const before = new InputEvent("beforeinput", {
        bubbles: true, inputType: "insertCompositionText", data,
        isComposing: true, cancelable: false
    });
    element.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    // jsdom has no native IME; model the DOM update between beforeinput/input.
    element.textContent = text;
    element.dispatchEvent(new InputEvent("input", {
        bubbles: true, inputType: "insertCompositionText", data, isComposing: true
    }));
}

describe("native composition", () => {
    it("commits one settled edit and shifts unrelated formatting", () => {
        const { element, editor, changes } = setup({
            text: "Hello world", annotations: [
                { range: [6, 11], tag: "<strong>", order: 1 }
            ]
        });
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "ca world", "ca");
        provisional(element, "café world", "café");
        expect(editor.isComposing()).toBe(true);
        expect(editor.getText()).toBe("Hello world");
        expect(changes).toEqual([]);
        compose(element, "compositionend", "café");
        expect(editor.isComposing()).toBe(false);
        expect(editor.getValue()).toEqual({
            text: "café world", annotations: [
                { range: [5, 10], tag: "<strong>", order: 1 }
            ]
        });
        expect(changes).toEqual([editor.getValue()]);
        expect(element.querySelector("strong")?.textContent).toBe("world");
    });

    it("leaves Enter and formatting shortcuts to an active IME", () => {
        const { element, editor, changes } = setup();
        editor.focus(0, 5);
        compose(element, "compositionstart");
        for (const key of ["Enter", "b"]) {
            const event = new KeyboardEvent("keydown", {
                key, ctrlKey: key === "b", isComposing: true,
                bubbles: true, cancelable: true
            });
            element.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
        }
        provisional(element, "日本語 world", "日本語");
        compose(element, "compositionend", "日本語");
        expect(editor.getText()).toBe("日本語 world");
        expect(editor.getValue().annotations).toEqual([]);
        expect(changes).toHaveLength(1);
        editor.focus(editor.getLength());
        element.dispatchEvent(new InputEvent("beforeinput", {
            inputType: "insertText", data: "!", bubbles: true, cancelable: true
        }));
        expect(editor.getText()).toBe("日本語 world!");
        expect(changes).toHaveLength(2);
    });

    it("distinguishes cancellation from an empty committed deletion by the DOM", () => {
        const { element, editor, changes } = setup();
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "candidate world", "candidate");
        provisional(element, "Hello world", "");
        compose(element, "compositionend", "");
        expect(editor.getText()).toBe("Hello world");
        expect(changes).toEqual([]);
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, " world", "");
        compose(element, "compositionend", "");
        expect(editor.getText()).toBe(" world");
        expect(changes).toHaveLength(1);
    });

    it("uses pending formatting for composed insertion", () => {
        const { element, editor, changes } = setup({ text: "Hi ", annotations: [] });
        editor.focus(3);
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "b", ctrlKey: true, bubbles: true, cancelable: true
        }));
        compose(element, "compositionstart");
        provisional(element, "Hi café", "café");
        compose(element, "compositionend", "café");
        expect(changes).toEqual([{
            text: "Hi café", annotations: [
                { range: [3, 7], tag: "<strong>", order: 1 }
            ]
        }]);
    });

    it("keeps whole Unicode code points and excludes the newline sentinel", () => {
        const { element, editor, changes } = setup({
            text: "😀\n", annotations: [
                { range: [2, 3], tag: "<em>", order: 1 }
            ]
        });
        editor.focus(0, 2);
        compose(element, "compositionstart");
        element.firstChild!.textContent = "😃";
        compose(element, "compositionend", "😃");
        expect(editor.getValue()).toEqual({
            text: "😃\n", annotations: [
                { range: [2, 3], tag: "<em>", order: 1 }
            ]
        });
        expect(changes).toHaveLength(1);
    });

    it("does not replace provisional DOM when only decorations change", () => {
        const { element, editor } = setup();
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "café world", "café");
        const node = element.firstChild;
        editor.showSelectionRanges([{ start: 0, end: 4 }]);
        editor.clearSelectionRanges();
        expect(element.firstChild).toBe(node);
        expect(element.textContent).toBe("café world");
        compose(element, "compositionend", "café");
        expect(editor.getText()).toBe("café world");
    });

    it("retains a newer API edit when an abandoned composition ends", async () => {
        const { element, editor, changes } = setup();
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "café world", "café");
        editor.setValue({ text: "New authoritative value", annotations: [] });
        expect(editor.isComposing()).toBe(true);
        element.textContent = "late browser candidate";
        compose(element, "compositionend", "candidate");
        await Promise.resolve();
        expect(editor.getText()).toBe("New authoritative value");
        expect(element.textContent).toBe("New authoritative value");
        expect(changes).toEqual([editor.getValue()]);
        expect(editor.isComposing()).toBe(false);
    });

    it("does not steal focus when composition commits on blur", () => {
        const { element, editor } = setup();
        const button = document.createElement("button");
        document.body.append(button);
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "café world", "café");
        button.focus();
        compose(element, "compositionend", "café");
        expect(editor.getText()).toBe("café world");
        expect(document.activeElement).toBe(button);
    });

    it("removes composition handling when the editor is destroyed", () => {
        const { element, editor, changes } = setup();
        editor.focus(0, 5);
        compose(element, "compositionstart");
        provisional(element, "café world", "café");
        editor.destroy();
        compose(element, "compositionend", "café");
        expect(editor.isComposing()).toBe(false);
        expect(editor.getText()).toBe("Hello world");
        expect(changes).toEqual([]);
    });
});
