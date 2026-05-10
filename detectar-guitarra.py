"""Enumera todos los joysticks conectados via WinMM y monitorea el primero
que parezca una guitarra (Guitar Hero / Rock Band) para identificar el mapping
fisico de trastes, strum y whammy.

Uso: python detectar-guitarra.py

Sin dependencias externas. Solo ctypes.
"""

import ctypes
import ctypes.wintypes
import time

JOYERR_NOERROR = 0
JOY_RETURNALL = 0xFF
MAX_JOYS = 16

JOYCAPS_HASZ = 0x0001
JOYCAPS_HASR = 0x0002
JOYCAPS_HASU = 0x0004
JOYCAPS_HASV = 0x0008
JOYCAPS_HASPOV = 0x0010


class JOYINFOEX(ctypes.Structure):
    _fields_ = [
        ("dwSize",        ctypes.wintypes.DWORD),
        ("dwFlags",       ctypes.wintypes.DWORD),
        ("dwXpos",        ctypes.wintypes.DWORD),
        ("dwYpos",        ctypes.wintypes.DWORD),
        ("dwZpos",        ctypes.wintypes.DWORD),
        ("dwRpos",        ctypes.wintypes.DWORD),
        ("dwUpos",        ctypes.wintypes.DWORD),
        ("dwVpos",        ctypes.wintypes.DWORD),
        ("dwButtons",     ctypes.wintypes.DWORD),
        ("dwButtonNumber",ctypes.wintypes.DWORD),
        ("dwPOV",         ctypes.wintypes.DWORD),
        ("dwReserved1",   ctypes.wintypes.DWORD),
        ("dwReserved2",   ctypes.wintypes.DWORD),
    ]


class JOYCAPSW(ctypes.Structure):
    _fields_ = [
        ("wMid",          ctypes.wintypes.WORD),
        ("wPid",          ctypes.wintypes.WORD),
        ("szPname",       ctypes.wintypes.WCHAR * 32),
        ("wXmin",         ctypes.wintypes.UINT),
        ("wXmax",         ctypes.wintypes.UINT),
        ("wYmin",         ctypes.wintypes.UINT),
        ("wYmax",         ctypes.wintypes.UINT),
        ("wZmin",         ctypes.wintypes.UINT),
        ("wZmax",         ctypes.wintypes.UINT),
        ("wNumButtons",   ctypes.wintypes.UINT),
        ("wPeriodMin",    ctypes.wintypes.UINT),
        ("wPeriodMax",    ctypes.wintypes.UINT),
        ("wRmin",         ctypes.wintypes.UINT),
        ("wRmax",         ctypes.wintypes.UINT),
        ("wUmin",         ctypes.wintypes.UINT),
        ("wUmax",         ctypes.wintypes.UINT),
        ("wVmin",         ctypes.wintypes.UINT),
        ("wVmax",         ctypes.wintypes.UINT),
        ("wCaps",         ctypes.wintypes.UINT),
        ("wMaxAxes",      ctypes.wintypes.UINT),
        ("wNumAxes",      ctypes.wintypes.UINT),
        ("wMaxButtons",   ctypes.wintypes.UINT),
        ("szRegKey",      ctypes.wintypes.WCHAR * 32),
        ("szOEMVxD",      ctypes.wintypes.WCHAR * 260),
    ]


winmm = ctypes.windll.winmm
winmm.joyGetDevCapsW.argtypes = [ctypes.wintypes.UINT, ctypes.POINTER(JOYCAPSW), ctypes.wintypes.UINT]
winmm.joyGetDevCapsW.restype = ctypes.wintypes.UINT


def enumerate_joysticks():
    """Devuelve lista de (joyId, caps, info) para cada slot conectado."""
    found = []
    for jid in range(MAX_JOYS):
        info = JOYINFOEX()
        info.dwSize = ctypes.sizeof(JOYINFOEX)
        info.dwFlags = JOY_RETURNALL
        if winmm.joyGetPosEx(jid, ctypes.byref(info)) != JOYERR_NOERROR:
            continue
        caps = JOYCAPSW()
        if winmm.joyGetDevCapsW(jid, ctypes.byref(caps), ctypes.sizeof(JOYCAPSW)) != JOYERR_NOERROR:
            continue
        found.append((jid, caps, info))
    return found


def looks_like_guitar(caps):
    """Heuristica: 8-13 botones + eje Z (whammy). La alfombra suele tener 16."""
    name = (caps.szPname or "").lower()
    if any(kw in name for kw in ("guitar", "rock band", "harmonix", "gh ")):
        return True
    has_z = bool(caps.wCaps & JOYCAPS_HASZ)
    return 8 <= caps.wNumButtons <= 14 and has_z


def fmt_caps(caps):
    flags = []
    if caps.wCaps & JOYCAPS_HASZ:   flags.append("Z")
    if caps.wCaps & JOYCAPS_HASR:   flags.append("R")
    if caps.wCaps & JOYCAPS_HASU:   flags.append("U")
    if caps.wCaps & JOYCAPS_HASV:   flags.append("V")
    if caps.wCaps & JOYCAPS_HASPOV: flags.append("POV")
    return f"VID={caps.wMid:04X} PID={caps.wPid:04X} | '{caps.szPname}' | {caps.wNumButtons} btns | ejes:X,Y,{','.join(flags) or '-'}"


def buttons_changed(prev, curr, num_btns):
    """Devuelve lista de (idx, pressed) para botones que cambiaron."""
    diffs = []
    for i in range(num_btns):
        bit = 1 << i
        was = bool(prev & bit)
        now = bool(curr & bit)
        if was != now:
            diffs.append((i, now))
    return diffs


def axis_norm(val, vmin, vmax):
    if vmax <= vmin:
        return 0.0
    return (val - vmin) / (vmax - vmin) * 2 - 1  # -1..+1


def main():
    print("=" * 70)
    print("DETECCION DE JOYSTICKS (WinMM)")
    print("=" * 70)
    joys = enumerate_joysticks()
    if not joys:
        print("No se detecto NINGUN joystick conectado.")
        print("Revisa: receptor enchufado, drivers HID OK, otra app usandolo.")
        return

    for jid, caps, info in joys:
        marker = "  >> POSIBLE GUITARRA <<" if looks_like_guitar(caps) else ""
        print(f"[Joy{jid}] {fmt_caps(caps)}{marker}")

    print()
    guitars = [j for j in joys if looks_like_guitar(j[1])]
    if guitars:
        target = guitars[0]
        print(f"Monitoreando Joy{target[0]} ('{target[1].szPname}') durante 30s.")
        print("Pulsa los trastes UNO POR UNO (Verde, Rojo, Amarillo, Azul, Naranja),")
        print("luego prueba Strum arriba/abajo y la palanca de Whammy.")
    else:
        target = joys[0]
        print(f"Ninguno parece guitarra por heuristica. Monitoreando Joy{target[0]} igualmente.")
        print("Si pulsas algo y nada se imprime, prueba otro slot conectando solo la guitarra.")

    print("-" * 70)
    print(f"{'t (s)':>6} | evento")
    print("-" * 70)

    jid = target[0]
    caps = target[1]
    nb = caps.wNumButtons
    info = JOYINFOEX()
    info.dwSize = ctypes.sizeof(JOYINFOEX)
    info.dwFlags = JOY_RETURNALL

    prev_buttons = 0
    prev_pov = 0xFFFF
    prev_z = None
    z_baseline = None
    t0 = time.time()
    deadline = t0 + 30
    polls = 0
    last_poll_print = t0

    while time.time() < deadline:
        info.dwFlags = JOY_RETURNALL
        if winmm.joyGetPosEx(jid, ctypes.byref(info)) == JOYERR_NOERROR:
            polls += 1
            t = time.time() - t0
            for idx, pressed in buttons_changed(prev_buttons, info.dwButtons, nb):
                state = "DOWN" if pressed else "up  "
                print(f"{t:>6.2f} | btn[{idx:2}] {state}")
            prev_buttons = info.dwButtons
            if info.dwPOV != prev_pov:
                if info.dwPOV == 0xFFFF:
                    print(f"{t:>6.2f} | POV centro")
                else:
                    deg = info.dwPOV / 100.0
                    label = {0:"ARRIBA", 90:"DERECHA", 180:"ABAJO", 270:"IZQUIERDA"}.get(int(deg), f"{deg:.0f}deg")
                    print(f"{t:>6.2f} | POV {label}")
                prev_pov = info.dwPOV
            if caps.wCaps & JOYCAPS_HASZ:
                z = info.dwZpos
                if z_baseline is None:
                    z_baseline = z
                    prev_z = z
                if abs(z - prev_z) > 2000:
                    norm = axis_norm(z, caps.wZmin, caps.wZmax)
                    print(f"{t:>6.2f} | Z (whammy?) = {z} (norm {norm:+.2f})")
                    prev_z = z
        if time.time() - last_poll_print > 5:
            elapsed = time.time() - t0
            rate = polls / elapsed if elapsed else 0
            print(f"  ... polling rate: {rate:.0f} Hz")
            last_poll_print = time.time()
        time.sleep(0.005)

    print("-" * 70)
    print("Fin del test.")
    print(f"Polls totales: {polls} en {time.time()-t0:.1f}s -> {polls/(time.time()-t0):.0f} Hz")


if __name__ == "__main__":
    main()
