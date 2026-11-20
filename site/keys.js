// KeyboardEvent.code -> код клавиши ядра (оболочка Godot: platform/godot/src/godot_scancodes.h)
const K = 16777216;
export const KEYMAP = {
  Escape: K + 1, Tab: K + 2, Backspace: K + 4, Enter: K + 5, NumpadEnter: K + 5,
  Insert: K + 7, Delete: K + 8, Home: K + 13, End: K + 14,
  ArrowLeft: K + 15, ArrowUp: K + 16, ArrowRight: K + 17, ArrowDown: K + 18,
  PageUp: K + 19, PageDown: K + 20,
  ShiftLeft: K + 21, ShiftRight: K + 21, ControlLeft: K + 22, ControlRight: K + 22,
  MetaLeft: K + 23, MetaRight: K + 23, AltLeft: K + 24, AltRight: K + 24, CapsLock: K + 25,
  Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
  Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96,
};
for (let i = 0; i < 10; i++) KEYMAP['Digit' + i] = 48 + i;
for (let i = 0; i < 26; i++) KEYMAP['Key' + String.fromCharCode(65 + i)] = 65 + i;
for (let i = 1; i <= 12; i++) KEYMAP['F' + i] = K + 27 + i;
