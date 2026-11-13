/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
    edit,
    RICH_TEXT_NOTE_CHANGE_EVENT,
    RICH_TEXT_NOTE_FRAGMENT_TYPE,
    type Editor,
    type Fragment,
    type RichTextNoteChangeDetail
} from "../src/index.js";

const editors: Editor[] = [];

afterEach(() => {
    for (const editor of editors.splice(0)) {
        editor.destroy();
    }
    document.body.replaceChildren();
});

function setup(text = "hello") {
    const parent = document.createElement("section");
    const element = document.createElement("div");
    parent.append(element);
    document.body.append(parent);
    const changes: Fragment[] = [];
    parent.addEventListener(RICH_TEXT_NOTE_CHANGE_EVENT, (event) => {
        const change = event as CustomEvent<RichTextNoteChangeDetail>;
        expect(event.target).toBe(element);
        changes.push(change.detail.fragment);
    });
    const editor = edit(element, { text, annotations: [] });
    editors.push(editor);
    return { element, editor, changes };
}

function input(element: HTMLElement, inputType: string, data: string | null = null) {
    element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType,
        data
    }));
}

function clipboard(element: HTMLElement, type: string, text = "") {
    const values = new Map([["text/plain", text]]);
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
        value: {
            getData: (key: string) => values.get(key) || "",
            setData: (key: string, value: string) => values.set(key, value)
        }
    });
    element.dispatchEvent(event);
    return values;
}

describe("rich text change notifications", () => {
    it("bubbles one settled snapshot for typing, deletion and a newline", () => {
        const { element, editor, changes } = setup();
        const rendered: { text: string | null; caret: number | undefined }[] = [];
        element.addEventListener(RICH_TEXT_NOTE_CHANGE_EVENT, () => {
            rendered.push({
                text: element.textContent?.replace(/\u200b/g, "") ?? null,
                caret: editor.getSelection()?.start
            });
        });
        editor.focus(5);
        input(element, "insertText", "!");
        input(element, "deleteContentBackward");
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true, cancelable: true
        }));
        expect(changes.map(value => value.text)).toEqual([
            "hello!", "hello", "hello\n"
        ]);
        expect(rendered).toEqual([
            { text: "hello!", caret: 6 },
            { text: "hello", caret: 5 },
            { text: "hello\n", caret: 6 }
        ]);
    });

    it("reports cut and paste as complete edits and copy as no change", () => {
        const { element, editor, changes } = setup();
        editor.focus(1, 4);
        expect(clipboard(element, "copy").get("text/plain")).toBe("ell");
        expect(changes).toEqual([]);
        clipboard(element, "cut");
        expect(changes.map(value => value.text)).toEqual(["ho"]);
        editor.focus(0, 2);
        clipboard(element, "paste", "replacement");
        expect(changes.map(value => value.text)).toEqual(["ho", "replacement"]);
    });

    it("reports annotation-only edits without counting pending styles", () => {
        const { element, editor, changes } = setup();
        editor.focus(5);
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "b", ctrlKey: true, bubbles: true, cancelable: true
        }));
        expect(changes).toEqual([]);
        input(element, "insertText", "!");
        expect(changes).toHaveLength(1);
        expect(changes[0].annotations).toContainEqual({
            range: [5, 6], tag: "<strong>", order: 1
        });
        editor.focus(0, 5);
        element.dispatchEvent(new KeyboardEvent("keydown", {
            key: "i", ctrlKey: true, bubbles: true, cancelable: true
        }));
        expect(changes).toHaveLength(2);
        expect(changes[1].text).toBe("hello!");
        expect(changes[1].annotations.some(item => item.tag === "<em>")).toBe(true);
    });

    it("reports programmatic changes, including replacement and formatting", () => {
        const { editor, changes } = setup();
        editor.insertText(5, "!");
        editor.deleteRange(0, 1);
        editor.insertFragment(0, {
            type: RICH_TEXT_NOTE_FRAGMENT_TYPE,
            data: { text: "H", annotations: [] }
        });
        expect(changes.map(value => value.text)).toEqual([
            "hello!", "ello!", "Hello!"
        ]);
        expect(editor.applyCommand("strong", { start: 0, end: 5 })).toBe(true);
        expect(changes).toHaveLength(4);
        expect(changes[3].annotations[0].tag).toBe("<strong>");
        editor.setValue({ text: "restored", annotations: [] });
        expect(changes.at(-1)).toEqual({ text: "restored", annotations: [] });
        expect(changes).toHaveLength(5);
    });

    it("does not notify for mounting, selection or equivalent values", () => {
        const { element, editor, changes } = setup();
        editor.focus(0);
        input(element, "deleteContentBackward");
        editor.focus(5);
        input(element, "deleteContentForward");
        editor.showSelectionRanges([{ start: 0, end: 3 }]);
        editor.clearSelectionRanges();
        editor.setValue(editor.getValue());
        editor.insertText(0, "");
        editor.deleteRange(0, 0);
        editor.applyCommand("unknown", { start: 0, end: 3 });
        editor.sliceFragment(0, 3);
        editor.splitFragment(2);
        expect(changes).toEqual([]);
    });

    it("isolates event snapshots from the editor, later edits and its baseline", () => {
        const { editor, changes } = setup();
        editor.applyCommand("strong", { start: 0, end: 5 });
        const first = changes[0];
        first.text = "listener mutation";
        first.annotations[0].range[0] = 3;
        expect(editor.getValue()).toEqual({
            text: "hello",
            annotations: [{ range: [0, 5], tag: "<strong>", order: 1 }]
        });
        editor.setValue(editor.getValue());
        expect(changes).toHaveLength(1);
        editor.insertText(5, "!");
        expect(first.text).toBe("listener mutation");
        expect(first.annotations[0].range).toEqual([3, 5]);
        expect(changes[1].text).toBe("hello!");
    });

    it("supports synchronous value normalization without duplicate events", () => {
        const { element, editor, changes } = setup();
        element.addEventListener(RICH_TEXT_NOTE_CHANGE_EVENT, () => {
            const value = editor.getValue();
            editor.setValue({ ...value, text: value.text.toUpperCase() });
        });
        editor.insertText(5, "!");
        expect(editor.getText()).toBe("HELLO!");
        expect(changes).toHaveLength(2);
        expect(new Set(changes.map(value => value.text))).toEqual(
            new Set(["hello!", "HELLO!"])
        );
    });

    it("stops notifications and input handling after destroy", () => {
        const { element, editor, changes } = setup();
        editor.focus(5);
        editor.destroy();
        input(element, "insertText", "!");
        expect(editor.getText()).toBe("hello");
        editor.setValue({ text: "detached", annotations: [] });
        expect(changes).toEqual([]);
    });
});
