# Gobliiins на Векторе-06Ц

Порт Gobliiins (Coktel Vision, 1991) на советский компьютер Вектор-06Ц, в браузере:
**https://gobliiins-kundo.github.io/gobliiins-v06c/**

Pre-alpha. Ошибки — в [issues](https://github.com/gobliiins-kundo/gobliiins-v06c/issues).

## Что внутри

- `v06x/` — эмулятор [v06x](https://github.com/svofski/vector06sdl) (форк с винчестером на портах 50h–58h,
  проигрывателем PCM ComboLite на 3Ch, вторым квазидиском на 11h и мышью KTSerg на D4h).
- `web/web_main.cpp` — ядро для браузера, `web/build.sh` — сборка в WebAssembly (Emscripten).
- `site/` — страница: `app.js` (картинка, звук через AudioWorklet, клавиатура, мышь), `data/gob.hdd` — образ
  винчестера с МикроДОС T-72 и игрой, `data/os-t72h.rom` — загрузчик T-72 с винчестера.

## Сборка

```
git submodule update --init --recursive
./web/build.sh
python3 -m http.server -d site
```
