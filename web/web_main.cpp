// Вектор-06Ц в браузере: ядро v06x (как оболочка Godot, без SDL) + вызовы для JS.
// Кадр гонит JS (web/app.js): v_frame() -> картинка, v_audio() -> звук этого кадра.
#include <emscripten.h>
#include <cstdio>
#include <cstring>
#include <vector>

#include "memory.h"
#include "vio.h"
#include "tv.h"
#include "board.h"
#include "emulator.h"
#include "options.h"
#include "keyboard.h"
#include "8253.h"
#include "sound.h"
#include "ay.h"
#include "wav.h"
#include "util.h"
#include "debug.h"
#include "i8080.h"

Memory memory;
FD1793 fdc;
Wav wav;
WavPlayer tape_player(wav);
Keyboard keyboard;
I8253 timer;
TimerWrapper tw(timer);
AY ay;
AYWrapper aw(ay);
Soundnik soundnik(tw, aw);
IO io(memory, keyboard, timer, fdc, ay, tape_player);
TV tv;
PixelFiller filler(memory, io, tv);
Debug debug(&memory);
Board board(memory, io, filler, soundnik, tv, tape_player, debug);
Emulator lator(board);

static std::vector<float> audio;
static bool ruslat = false;

extern "C" {

EMSCRIPTEN_KEEPALIVE int v_init()
{
    // два квазидиска (порты 10h и 11h), как на стенде: игра с одним портит палитру интро и пишет в экран
    memory.enable_kvaz2(true);
    filler.init();
    soundnik.init(nullptr);
    tv.init();
    board.init();
    fdc.init();
    keyboard.onreset = [](bool blkvvod) {
        board.reset(blkvvod ? Board::ResetMode::BLKVVOD : Board::ResetMode::BLKSBR);
    };
    io.onruslat = [](bool r) { ruslat = r; };
    // ComboLite: проигрыватель PCM (порт 3Ch), канал ESP; без папки дорожек -- только ячейки из ОЗУ
    setenv("COMBOLITE_MUSIC", "/nonexistent", 1);
    io.combo.poll_us = 500;
    io.combo.clock = []() -> size_t { return board.get_cycles(); };
    io.enable_combolite();
    board.hooks.device_frame = []() { io.combo.frame(board.get_frame_no()); };
    board.reset(Board::ResetMode::BLKVVOD);
    return 0;
}

EMSCRIPTEN_KEEPALIVE int v_width() { return Options.screen_width; }
EMSCRIPTEN_KEEPALIVE int v_height() { return Options.screen_height; }
EMSCRIPTEN_KEEPALIVE int v_border() { return Options.border_width; }

// ПЗУ (загрузчик) с адреса org
EMSCRIPTEN_KEEPALIVE void v_load_rom(const uint8_t * p, int n, int org)
{
    std::vector<uint8_t> bin(p, p + n);
    memory.init_from_vector(bin, org);
}

EMSCRIPTEN_KEEPALIVE void v_load_fdd(const uint8_t * p, int n, int drive)
{
    std::vector<uint8_t> img(p, p + n);
    fdc.disk(drive).attach(img);
}

// винчестер на портах 50h-58h: образ лежит в файловой системе Emscripten (JS кладёт его туда)
EMSCRIPTEN_KEEPALIVE int v_attach_hdd(const char * path)
{
    return io.hdd.attach(path) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void v_reset(int blkvvod)
{
    board.reset(blkvvod ? Board::ResetMode::BLKVVOD : Board::ResetMode::BLKSBR);
}

// один кадр (1/50 с); указатель на картинку RGBA width x height
EMSCRIPTEN_KEEPALIVE const uint8_t * v_frame()
{
    lator.execute_frame();
    return (const uint8_t *)board.get_tv().pixels();
}

// звук: n стереоотсчётов (48 кГц), float, чередуются L R
EMSCRIPTEN_KEEPALIVE const float * v_audio(int n)
{
    if ((int)audio.size() < n * 2) audio.resize(n * 2);
    lator.export_audio_frame(audio.data(), (size_t)n * 2);
    return audio.data();
}

// клавиша: код SDL (USB HID)
EMSCRIPTEN_KEEPALIVE void v_key(int scancode, int down)
{
    if (down) lator.keydown(scancode); else lator.keyup(scancode);
}

// мышь KTSerg (D4h): x 0..511, y 0..255 снизу вверх (как SetMouse оболочки), кнопки 1 лев 2 прав 4 сред
EMSCRIPTEN_KEEPALIVE void v_mouse(int x, int y, int buttons, int wheel, int inside)
{
    io.mouse.host_buttons(buttons);
    if (wheel) io.mouse.host_wheel(wheel);
    if (inside) io.mouse.host_move(x, y);
}
EMSCRIPTEN_KEEPALIVE int v_mouse_enabled() { return io.mouse.is_enabled() ? 1 : 0; }
// для детекторов: регистры на конце кадра и чтение основного ОЗУ
EMSCRIPTEN_KEEPALIVE int v_pc() { return i8080cpu::i8080_pc(); }
EMSCRIPTEN_KEEPALIVE int v_sp() { return i8080cpu::i8080_regs_sp(); }
EMSCRIPTEN_KEEPALIVE int v_iff() { return i8080cpu::i8080_iff() ? 1 : 0; }
EMSCRIPTEN_KEEPALIVE int v_peek(int addr) { return memory.read(addr & 0xffff, false); }
EMSCRIPTEN_KEEPALIVE int v_frame_no() { return board.get_frame_no(); }
EMSCRIPTEN_KEEPALIVE int v_ruslat() { return ruslat ? 1 : 0; }

EMSCRIPTEN_KEEPALIVE void v_volumes(float timer, float beeper, float ayv, float pcm, float master)
{
    lator.set_volumes(timer, beeper, ayv, pcm, master);
}

}
