// Desktop fork (section 120): clip boxes and blend modes of Drawables and pen lines, built in from TurboWarp's
// "Clipping & Blending" extension (Xeltalliv, MIT) so that it and SharkPool's Particle Engine no longer replace
// renderer functions. Used when the stage is drawn, when a sprite is stamped and when pen lines are drawn.

/** @type {WeakMap<WebGLRenderingContext, {canvas: object, framebuffer: object}>} */
const tables = new WeakMap();

/**
 * @param {WebGLRenderingContext} gl - the context.
 * @returns {{canvas: object, framebuffer: object}} blend mode name → [src RGB, dst RGB, src alpha, dst alpha,
 * equation], for drawing to the canvas and to a framebuffer (only the legacy modes differ).
 */
const getTables = gl => {
    let result = tables.get(gl);
    if (result) return result;
    // prettier-ignore
    const framebuffer = Object.assign(Object.create(null), {
        'default': [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.FUNC_ADD],
        'default behind': [gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.FUNC_ADD],
        'additive': [gl.ONE, gl.ONE, gl.ZERO, gl.ONE, gl.FUNC_ADD],
        'additive with alpha': [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.FUNC_ADD],
        'additive legacy': [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.FUNC_ADD],
        'subtract': [gl.ONE, gl.ONE, gl.ZERO, gl.ONE, gl.FUNC_REVERSE_SUBTRACT],
        'subtract with alpha': [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.FUNC_REVERSE_SUBTRACT],
        'subtract legacy': [gl.ONE, gl.ONE, gl.ONE, gl.ONE, gl.FUNC_REVERSE_SUBTRACT],
        'multiply': [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.FUNC_ADD],
        'invert': [gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE, gl.FUNC_ADD],
        'invert legacy': [
            gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.FUNC_ADD
        ],
        'mask': [gl.ZERO, gl.SRC_ALPHA, gl.ZERO, gl.SRC_ALPHA, gl.FUNC_ADD],
        'erase': [gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.FUNC_ADD]
    });
    const canvas = Object.assign(Object.create(null), framebuffer, {
        'subtract legacy': [gl.ONE, gl.ONE, gl.ZERO, gl.ONE, gl.FUNC_REVERSE_SUBTRACT],
        'invert legacy': [gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ZERO, gl.ONE, gl.FUNC_ADD]
    });
    result = {canvas, framebuffer};
    tables.set(gl, result);
    return result;
};

/**
 * Go back to normal drawing: no clip box, normal blending.
 * @param {WebGLRenderingContext} gl - the context.
 */
const reset = gl => {
    gl.disable(gl.SCISSOR_TEST);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
};

/**
 * Set up the clip box and blend mode for the next draw.
 * @param {WebGLRenderingContext} gl - the context.
 * @param {?object} clipbox - {x_min, y_min, x_max, y_max} in stage coordinates, or null.
 * @param {?string} blendMode - a blend mode name; null, "default" or an unknown name: normal.
 * @param {{toCanvas: boolean, width: number, height: number, flipY: boolean}} target - what is drawn to: the
 * canvas or a framebuffer, its size in pixels, and whether y points down (framebuffers).
 * @param {Array<number>} nativeSize - the stage size.
 * @returns {boolean} true when something other than normal drawing was set (call reset afterwards).
 */
const apply = (gl, clipbox, blendMode, target, nativeSize) => {
    const blends = getTables(gl)[target.toCanvas ? 'canvas' : 'framebuffer'];
    const blend = (blendMode !== null && blendMode !== 'default' && blends[blendMode]) || null;
    if (clipbox === null && blend === null) {
        reset(gl);
        return false;
    }
    if (clipbox === null) {
        gl.disable(gl.SCISSOR_TEST);
    } else {
        gl.enable(gl.SCISSOR_TEST);
        const width = target.width;
        const height = target.height;
        const x = (((clipbox.x_min / nativeSize[0]) + 0.5) * width) | 0;
        let y = (((clipbox.y_min / nativeSize[1]) + 0.5) * height) | 0;
        const x2 = (((clipbox.x_max / nativeSize[0]) + 0.5) * width) | 0;
        const y2 = (((clipbox.y_max / nativeSize[1]) + 0.5) * height) | 0;
        const w = x2 - x;
        const h = y2 - y;
        if (target.flipY) {
            y = (((-clipbox.y_max / nativeSize[1]) + 0.5) * height) | 0;
        }
        gl.scissor(x, y, w, h);
    }
    const b = blend || blends.default;
    gl.blendEquation(b[4]);
    gl.blendFuncSeparate(b[0], b[1], b[2], b[3]);
    return true;
};

/**
 * @param {?object} clipbox - a clip box or null.
 * @returns {?object} a copy with only its four numbers, or null.
 */
const copyClipBox = clipbox => (clipbox ? {
    x_min: clipbox.x_min, y_min: clipbox.y_min, x_max: clipbox.x_max, y_max: clipbox.y_max
} : null);

module.exports = {apply, reset, copyClipBox};
