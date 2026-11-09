class CanvasMeasurementProvider {
    /**
     * @param {CanvasRenderingContext2D} ctx - provides a canvas rendering context
     * with 'font' set to the text style of the text to be wrapped.
     */
    constructor (ctx) {
        this._ctx = ctx;
        this._cache = {};
        // Desktop fork (section 214): how many widths the cache holds; it is emptied at CACHE_LIMIT
        this._cacheSize = 0;
    }


    // We don't need to set up or tear down anything here. Should these be removed altogether?

    /**
     * Called by the TextWrapper before a batch of zero or more calls to measureText().
     */
    beginMeasurementSession () {

    }

    /**
     * Called by the TextWrapper after a batch of zero or more calls to measureText().
     */
    endMeasurementSession () {

    }

    setFontAndSize (font, size) {
        this._ctx.font = `${size}px ${font}, sans-serif`;
        this._cache = {};
        this._cacheSize = 0;
    }

    /**
     * Measure a whole string as one unit.
     * @param {string} text - the text to measure.
     * @returns {number} - the length of the string.
     */
    measureText (text) {
        const cacheName = this._ctx.font + text;
        if (!this._cache[cacheName]) {
            // Desktop fork (section 214): a speech bubble whose text changes every frame kept every width it ever
            // measured, for as long as the bubble stayed; the cache is emptied when it is full instead
            if (this._cacheSize >= CanvasMeasurementProvider.CACHE_LIMIT) {
                this._cache = {};
                this._cacheSize = 0;
            }
            this._cache[cacheName] = this._ctx.measureText(text).actualBoundingBoxRight;
            this._cacheSize++;
        }
        return this._cache[cacheName];
    }
}

// Desktop fork (section 214): the most widths a measurement provider remembers (one text needs several)
CanvasMeasurementProvider.CACHE_LIMIT = 1000;

module.exports = CanvasMeasurementProvider;
