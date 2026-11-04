#!/usr/bin/env python3
"""Draws Revelio's tab icons into icons/*-symbolic.svg.

GNOME Shell recolours symbolic icons by forcing `fill` on every shape and ignores strokes, so each
rounded stroke here is emitted as a filled outline (capsules, rings, arcs, frames). 16 px grid,
1.5 px strokes. Run: python3 tools/icons.py
"""
import math
import os

W = 1.5  # stroke width


def f(n):
    return f'{n:.3f}'.rstrip('0').rstrip('.')


def seg(x1, y1, x2, y2, w=W):
    """A line with round caps."""
    h = w / 2
    d = math.hypot(x2 - x1, y2 - y1) or 1
    nx, ny = -(y2 - y1) / d * h, (x2 - x1) / d * h
    return (f'<path d="M{f(x1 + nx)} {f(y1 + ny)}L{f(x2 + nx)} {f(y2 + ny)}'
            f'A{f(h)} {f(h)} 0 0 0 {f(x2 - nx)} {f(y2 - ny)}L{f(x1 - nx)} {f(y1 - ny)}'
            f'A{f(h)} {f(h)} 0 0 0 {f(x1 + nx)} {f(y1 + ny)}Z"/>')


def poly(pts, w=W, closed=False):
    """Connected lines with round joins."""
    pts = pts + [pts[0]] if closed else pts
    out = [seg(*a, *b, w) for a, b in zip(pts, pts[1:])]
    return ''.join(out) + ''.join(dot(x, y, w / 2) for x, y in pts[1:-1])


def dot(cx, cy, r):
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}"/>'


def circle_path(cx, cy, r):
    return (f'M{f(cx - r)} {f(cy)}A{f(r)} {f(r)} 0 1 0 {f(cx + r)} {f(cy)}'
            f'A{f(r)} {f(r)} 0 1 0 {f(cx - r)} {f(cy)}Z')


def ring(cx, cy, r, w=W):
    return f'<path fill-rule="evenodd" d="{circle_path(cx, cy, r + w / 2)}{circle_path(cx, cy, r - w / 2)}"/>'


def arc(cx, cy, r, a0, a1, w=W):
    """Thick arc with round caps; degrees clockwise from 12 o'clock."""
    h = w / 2
    pt = lambda a, rr: (cx + rr * math.sin(math.radians(a)), cy - rr * math.cos(math.radians(a)))
    large = 1 if (a1 - a0) % 360 > 180 else 0
    (ox0, oy0), (ox1, oy1) = pt(a0, r + h), pt(a1, r + h)
    (ix0, iy0), (ix1, iy1) = pt(a0, r - h), pt(a1, r - h)
    return (f'<path d="M{f(ox0)} {f(oy0)}A{f(r + h)} {f(r + h)} 0 {large} 1 {f(ox1)} {f(oy1)}'
            f'A{f(h)} {f(h)} 0 0 1 {f(ix1)} {f(iy1)}A{f(r - h)} {f(r - h)} 0 {large} 0 {f(ix0)} {f(iy0)}'
            f'A{f(h)} {f(h)} 0 0 1 {f(ox0)} {f(oy0)}Z"/>')


def rrect_path(x, y, w, h, r):
    r = min(r, w / 2, h / 2)
    return (f'M{f(x + r)} {f(y)}H{f(x + w - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w)} {f(y + r)}'
            f'V{f(y + h - r)}A{f(r)} {f(r)} 0 0 1 {f(x + w - r)} {f(y + h)}H{f(x + r)}'
            f'A{f(r)} {f(r)} 0 0 1 {f(x)} {f(y + h - r)}V{f(y + r)}A{f(r)} {f(r)} 0 0 1 {f(x + r)} {f(y)}Z')


def frame(x, y, w, h, r, sw=W):
    """Outline of a rounded rectangle whose stroke is centred on (x, y, w, h)."""
    s = sw / 2
    return (f'<path fill-rule="evenodd" d="{rrect_path(x - s, y - s, w + sw, h + sw, r + s)}'
            f'{rrect_path(x + s, y + s, w - sw, h - sw, max(r - s, 0))}"/>')


def block(x, y, w, h, r):
    return f'<path d="{rrect_path(x, y, w, h, r)}"/>'


ICONS = {
    # Equalizer bars: the closed island's beat, as the Music tab.
    'music': ''.join(seg(x, 8 - l / 2, x, 8 + l / 2, 2) for x, l in [(2.5, 4), (6.2, 11), (9.8, 7), (13.5, 3)]),
    # A countdown arc with a gap where the time has run, and a centre dot.
    'focus': arc(8, 8, 6, 0, 285) + dot(8, 8, 2),
    'tasks': frame(2.5, 2.5, 11, 11, 3.2) + poly([(5.4, 8.1), (7.3, 10), (10.7, 6.1)]),
    'money': frame(1.75, 3.75, 12.5, 9.5, 2.6) + frame(9.25, 6.75, 5, 3.5, 1.75) + seg(4, 1.75, 11, 1.75),
    'today': frame(2, 3, 12, 11, 2.8) + seg(2.75, 6.5, 13.25, 6.5) + seg(5.25, 1.25, 5.25, 3.5)
    + seg(10.75, 1.25, 10.75, 3.5) + block(9.25, 9, 2.5, 2.5, 0.8),
    'shelf': poly([(2.25, 9), (2.25, 12.25), (3.75, 13.75), (12.25, 13.75), (13.75, 12.25), (13.75, 9)])
    + seg(8, 1.75, 8, 9.25) + poly([(5.25, 6.75), (8, 9.5), (10.75, 6.75)]),
    'notifications': frame(2, 6, 12, 8, 2.5) + seg(4.5, 3.25, 11.5, 3.25) + seg(6.5, 1, 9.5, 1, 1.2),
    'clipboard': frame(2.75, 3, 10.5, 11.75, 2.5) + block(5.5, 1.25, 5, 3.25, 1.2)
    + seg(5.5, 8.5, 10.5, 8.5) + seg(5.5, 11.5, 8.75, 11.5),
    'script': seg(6.5, 3.5, 14, 3.5) + seg(6.5, 8, 12.25, 8) + seg(6.5, 12.5, 13.5, 12.5)
    + poly([(1.75, 5.75), (4.25, 8), (1.75, 10.25)], 1.5, True) + '<path d="M1.75 5.75L4.25 8L1.75 10.25Z"/>',
    'record': ring(8, 8, 6) + dot(8, 8, 2.9),
    'system': poly([(1.25, 8.75), (4.25, 8.75), (6, 3.75), (9.5, 12.75), (11.25, 8.75), (14.75, 8.75)]),
    'power': poly([(9.25, 1.5), (3.5, 9), (7.5, 9), (6.75, 14.5), (12.5, 7), (8.5, 7)], 1.3, True)
    + '<path d="M9.25 1.5L3.5 9L7.5 9L6.75 14.5L12.5 7L8.5 7Z"/>',
    # Sliders, not a gear.
    'settings': seg(1.75, 4.75, 14.25, 4.75) + seg(1.75, 11.25, 14.25, 11.25) + dot(10.5, 4.75, 2.4) + dot(5.5, 11.25, 2.4),
}

if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
    os.makedirs(out, exist_ok=True)
    for name, body in ICONS.items():
        with open(os.path.join(out, f'revelio-{name}-symbolic.svg'), 'w') as fh:
            fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">{body}</svg>\n')
