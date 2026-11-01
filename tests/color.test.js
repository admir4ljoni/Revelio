// gjs -m tests/color.test.js
import {accent} from '../src/lib/color.js';

const eq = (a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const image = colors => new Uint8Array(colors.flat());

// Mostly grey with some dark blue: blue wins, brightened.
eq(accent(image([[40, 40, 40], [40, 40, 40], [0, 0, 100], [0, 0, 120]]), 3, 6, 2, 2), [64, 64, 255]);
// Red and green don't average into brown: the bigger hue wins.
eq(accent(image([[200, 0, 0], [200, 0, 0], [0, 200, 0], [10, 10, 10]]), 3, 6, 2, 2), [255, 64, 64]);
// Grey art: no accent. RGBA with row padding is read right.
eq(accent(image([[90, 90, 90, 255], [200, 200, 200, 255], [0, 0, 0, 0], [5, 5, 5, 255], [9, 9, 9, 255], [0, 0, 0, 0]]), 4, 12, 2, 2), null);
print('color ok');
