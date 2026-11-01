// Desktop fork (section 190): a uniform grid of the bounds of one list of touching candidates, so a touching question
// compares only the candidates near the asker instead of all of them. See RenderWebGL._gridCandidatesTouching.

/** Cells per side. Bounds further out than the grid reaches are kept in the border cells, which is slower, not wrong. */
const CELLS = 128;
/** A candidate covering more cells than this goes in the list of big ones, compared at every question. */
const MAX_CELLS_PER_ENTRY = 64;

const NOT_PLACED = -1;
const IN_BIG_LIST = -2;

const toCell = (value, size) => {
    const cell = Math.floor(value / size) + (CELLS / 2);
    return cell < 0 ? 0 : (cell >= CELLS ? CELLS - 1 : cell);
};

class TouchingGrid {
    constructor () {
        // Which frame and list this grid is up to date with, kept by RenderWebGL.
        this.epoch = -1;
        this.syncedEpoch = -1;
        this.structure = -1;
        this.silhouettes = -1;
        this.source = null;
        this.logPosition = 0;
        this.queries = 0;
        this.active = false;
        // True when the list can't be used this frame (a candidate with a skin that is prepared at every question).
        this.unusable = false;

        this.length = 0;
        this.ids = [];
        this.drawables = [];
        this.skins = [];
        this.rects = [];
        // Index in the lists above by drawable ID; only valid if drawables[index] has that ID.
        this.indexById = new Int32Array(256);
        this.size = 0;
        this.cells = new Array(CELLS * CELLS).fill(null);
        this.big = [];
        this.x0 = new Int16Array(0);
        this.x1 = new Int16Array(0);
        this.y0 = new Int16Array(0);
        this.y1 = new Int16Array(0);
        this.stamps = new Uint32Array(0);
        this.stamp = 0;
        this.hits = [];
    }

    /**
     * Forget all places, keeping the cell arrays.
     */
    clear () {
        for (let i = 0; i < this.length; i++) {
            if (this.x0[i] >= 0) {
                for (let y = this.y0[i]; y <= this.y1[i]; y++) {
                    for (let x = this.x0[i]; x <= this.x1[i]; x++) this.cells[(y * CELLS) + x].length = 0;
                }
            }
        }
        this.big.length = 0;
    }

    /**
     * Take a new list of candidates, in the same order as _candidatesTouching: last ID first.
     * @param {Array<int>} candidateIDs - the list.
     * @param {Array<Drawable>} allDrawables - the renderer's drawables.
     * @param {function(Skin): number} skinKind - 0 for a skin left out of touching, 1 usable, 2 not usable.
     * @return {boolean} false if the grid can't be used for this list.
     */
    setList (candidateIDs, allDrawables, skinKind) {
        this.clear();
        this.length = 0;
        const count = candidateIDs.length;
        if (this.x0.length < count) {
            const capacity = count * 2;
            this.x0 = new Int16Array(capacity);
            this.x1 = new Int16Array(capacity);
            this.y0 = new Int16Array(capacity);
            this.y1 = new Int16Array(capacity);
            this.stamps = new Uint32Array(capacity);
            this.stamp = 0;
        }
        const {ids, drawables, skins, rects} = this;
        ids.length = drawables.length = skins.length = rects.length = 0;
        let usable = true;
        for (let index = count - 1; index >= 0; index--) {
            const id = candidateIDs[index];
            const drawable = allDrawables[id];
            // A missing drawable makes the full check throw, as before.
            if (!drawable) usable = false;
            else {
                if (skinKind(drawable.skin) === 2) usable = false;
                if (id >= this.indexById.length) {
                    const bigger = new Int32Array(Math.max(id + 1, this.indexById.length * 2));
                    bigger.set(this.indexById);
                    this.indexById = bigger;
                }
                const known = this.indexById[id];
                // The same drawable twice in the list: the full check would list it twice.
                if (known < ids.length && drawables[known] === drawable) usable = false;
                this.indexById[id] = ids.length;
            }
            this.x0[ids.length] = NOT_PLACED;
            ids.push(id);
            drawables.push(drawable);
            skins.push(drawable ? drawable.skin : null);
            rects.push(null);
        }
        this.length = usable ? count : 0;
        return usable;
    }

    /**
     * Choose the size of the cells from how many candidates there are and how large, and place them again if it changes.
     * @param {number} stageArea - the stage's area.
     */
    fitCellSize (stageArea) {
        let sum = 0;
        let placed = 0;
        for (let i = 0; i < this.length; i++) {
            const rect = this.rects[i];
            if (rect !== null) {
                sum += (rect.right - rect.left) + (rect.top - rect.bottom);
                placed++;
            }
        }
        if (placed === 0) {
            if (this.size === 0) this.size = 32;
            return;
        }
        const wanted = Math.max(0.75 * sum / placed, 2 * Math.sqrt(stageArea / placed));
        const size = Math.ceil(Math.min(256, Math.max(8, Number.isFinite(wanted) ? wanted : 8)));
        if (this.size === 0 || size > this.size * 1.25 || size < this.size * 0.75) {
            this.clear();
            for (let i = 0; i < this.length; i++) this.x0[i] = NOT_PLACED;
            this.size = size;
            for (let i = 0; i < this.length; i++) {
                if (this.rects[i] !== null) this.place(i, this.rects[i]);
            }
        }
    }

    /**
     * Take a candidate out of the grid.
     * @param {int} i - its index.
     */
    unplace (i) {
        const x0 = this.x0[i];
        if (x0 === NOT_PLACED) return;
        this.x0[i] = NOT_PLACED;
        if (x0 === IN_BIG_LIST) {
            const big = this.big;
            big[big.lastIndexOf(i)] = big[big.length - 1];
            big.pop();
            return;
        }
        for (let y = this.y0[i]; y <= this.y1[i]; y++) {
            for (let x = x0; x <= this.x1[i]; x++) {
                const cell = this.cells[(y * CELLS) + x];
                cell[cell.lastIndexOf(i)] = cell[cell.length - 1];
                cell.pop();
            }
        }
    }

    /**
     * Put a candidate where its bounds are.
     * @param {int} i - its index.
     * @param {Rectangle} rect - its bounds.
     */
    place (i, rect) {
        this.rects[i] = rect;
        if (this.size === 0) return;
        const size = this.size;
        const x0 = toCell(rect.left, size);
        const x1 = toCell(rect.right, size);
        const y0 = toCell(rect.bottom, size);
        const y1 = toCell(rect.top, size);
        // Not a number somewhere, or too many cells: goes with the big ones, compared at every question.
        const small = x1 >= x0 && y1 >= y0 && ((x1 - x0 + 1) * (y1 - y0 + 1)) <= MAX_CELLS_PER_ENTRY;
        if (!small) {
            if (this.x0[i] === IN_BIG_LIST) return;
            this.unplace(i);
            this.x0[i] = IN_BIG_LIST;
            this.big.push(i);
            return;
        }
        if (this.x0[i] === x0 && this.x1[i] === x1 && this.y0[i] === y0 && this.y1[i] === y1) return;
        this.unplace(i);
        this.x0[i] = x0;
        this.x1[i] = x1;
        this.y0[i] = y0;
        this.y1[i] = y1;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const key = (y * CELLS) + x;
                let cell = this.cells[key];
                if (cell === null) cell = this.cells[key] = [];
                cell.push(i);
            }
        }
    }

    /**
     * A candidate has no place: hidden, or no skin.
     * @param {int} i - its index.
     */
    remove (i) {
        this.unplace(i);
        this.rects[i] = null;
    }

    /**
     * Indexes of the placed candidates whose bounds intersect some bounds, in list order (smallest index first).
     * @param {Rectangle} bounds - the asker's bounds.
     * @return {Array<int>} the indexes; reused by the next question.
     */
    query (bounds) {
        const hits = this.hits;
        hits.length = 0;
        const {rects, stamps} = this;
        const size = this.size;
        const x0 = toCell(bounds.left, size);
        const x1 = toCell(bounds.right, size);
        const y0 = toCell(bounds.bottom, size);
        const y1 = toCell(bounds.top, size);
        let visits = (x1 - x0 + 1) * (y1 - y0 + 1);
        for (let y = y0; y <= y1 && visits < this.length; y++) {
            for (let x = x0; x <= x1; x++) {
                const cell = this.cells[(y * CELLS) + x];
                if (cell !== null) visits += cell.length;
            }
        }
        if (visits >= this.length) {
            // Packed together, or a very large asker: comparing them all, in order, is quicker.
            for (let i = 0; i < this.length; i++) {
                if (rects[i] !== null && bounds.intersects(rects[i])) hits.push(i);
            }
            return hits;
        }
        const stamp = ++this.stamp;
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const cell = this.cells[(y * CELLS) + x];
                if (cell === null) continue;
                for (let c = 0; c < cell.length; c++) {
                    const i = cell[c];
                    if (stamps[i] !== stamp) {
                        stamps[i] = stamp;
                        if (bounds.intersects(rects[i])) hits.push(i);
                    }
                }
            }
        }
        for (let c = 0; c < this.big.length; c++) {
            const i = this.big[c];
            if (bounds.intersects(rects[i])) hits.push(i);
        }
        if (hits.length > 1) hits.sort((a, b) => a - b);
        return hits;
    }
}

module.exports = TouchingGrid;
