// Accent color from album art pixels: the most prominent vivid hue, brightened to read on black.
// pixels: RGB(A) bytes as from GdkPixbuf. Returns [r, g, b] or null for grey art (keep white).
const BINS = 12;
const MIN_WEIGHT = 0.02; // share of a fully vivid image below which art counts as grey

export function accent(pixels, channels, rowstride, width, height) {
    const bins = Array.from({length: BINS}, () => ({w: 0, r: 0, g: 0, b: 0}));
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * rowstride + x * channels;
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (max === min)
                continue;
            const d = max - min;
            const hue = max === r ? (g - b) / d + 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            const w = (d / max) ** 2 * (max / 255); // saturation² × value: vivid beats pale or dark
            const bin = bins[Math.floor(hue % 6 / 6 * BINS)];
            bin.w += w;
            bin.r += r * w;
            bin.g += g * w;
            bin.b += b * w;
        }
    }
    const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
    if (best.w < MIN_WEIGHT * width * height)
        return null;
    const rgb = [best.r, best.g, best.b].map(c => c / best.w);
    // Full brightness, then 25% toward white so dark hues stay legible.
    const k = 255 / Math.max(...rgb);
    return rgb.map(c => Math.round(c * k * 0.75 + 255 * 0.25));
}

// Bar color for a level 0..1 where high is bad: the accent up to half, then toward yellow at 75%
// and red when full. rgb and result are 0..255.
const YELLOW = [245, 194, 17], RED = [224, 27, 36];
export function heat(rgb, level) {
    const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
    const l = Math.max(0, Math.min(1, level));
    return l <= 0.5 ? rgb : l <= 0.75 ? mix(rgb, YELLOW, (l - 0.5) * 4) : mix(YELLOW, RED, (l - 0.75) * 4);
}
