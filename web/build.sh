#!/usr/bin/env bash
# Сборка ядра v06x в WebAssembly: site/v06x.js + site/v06x.wasm
set -e
cd "$(dirname "$0")/.."
V=v06x
G=$V/platform/godot
SRC=(
  web/web_main.cpp
  $G/src/emulator_godot.cpp $G/src/godot_scancodes.cpp
  $G/boot/boot.c $G/boot/boots.c
  $V/src/options.cpp $V/src/memory.cpp $V/src/tv.cpp $V/src/i8080.cpp $V/src/hal.cpp $V/src/board.cpp
  $V/src/filler.cpp $V/src/cadence.cpp $V/src/util.cpp $V/src/sound.cpp $V/src/resampler.cpp
  $V/src/fsimage.cpp $V/src/debug.cpp $V/src/utils_string.cpp
  $V/src/combolite/*.c $V/src/combolite/vendor/micromod/*.c
)
INC=(-I$G/src -I$G -I$V/src -I$V/fast-filters/sources -I$V/coreutil/sources -I$V/boost -I$V/filters)
DEF=(-D__GODOT__ -D__WEB__ -DUSED_XXD=1 -DCHAISCRIPT_NO_THREADS=1 -DWITHOUT_COREDSP=1)
OUT=site
mkdir -p build/obj $OUT
OBJS=()
for s in "${SRC[@]}"; do
  o=build/obj/$(echo "$s" | tr '/' '_').o
  OBJS+=("$o")
  if [ ! -f "$o" ] || [ "$s" -nt "$o" ]; then
    case "$s" in
      *.c)   emcc -O3 "${DEF[@]}" "${INC[@]}" -c "$s" -o "$o" ;;
      *.cpp) em++ -O3 -std=c++17 -fpermissive -Wno-everything "${DEF[@]}" "${INC[@]}" -c "$s" -o "$o" ;;
    esac
  fi
done
em++ -O3 "${OBJS[@]}" -o $OUT/v06x.js \
  -sMODULARIZE=1 -sEXPORT_NAME=V06X -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAPF32,ccall,cwrap \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sENVIRONMENT=web -sFILESYSTEM=1
# то же ядро под Node: проигрыватель записей tools/replay.cjs
em++ -O3 "${OBJS[@]}" -o build/v06x-node.js \
  -sMODULARIZE=1 -sEXPORT_NAME=V06X -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,HEAPF32,ccall,cwrap \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sENVIRONMENT=node -sFILESYSTEM=1
ls -la $OUT/v06x.js $OUT/v06x.wasm build/v06x-node.js
