const twgl = require("twgl.js");

const Skin = require("./Skin");
const { loadSvgString, serializeSvgToString } = require("scratch-svg-renderer");
const ShaderManager = require("./ShaderManager");
const log = require("./util/log");

/**
 * All scaled renderings of the SVG are stored in an array. The 1.0 scale of
 * the SVG is stored at the 8th index. The smallest possible 1 / 256 scale
 * rendering is stored at the 0th index.
 * @const {number}
 */
const INDEX_OFFSET = 8;

class SVGSkin extends Skin {
  /**
   * Create a new SVG skin.
   * @param {!int} id - The ID for this Skin.
   * @param {!RenderWebGL} renderer - The renderer which will use this skin.
   * @constructor
   * @extends Skin
   */
  constructor(id, renderer, deferred = false) {
    super(id, renderer);

    /** @type {HTMLImageElement} */
    this._svgImage = deferred ? null : document.createElement("img");

    /** @type {boolean} */
    this._svgImageLoaded = false;

    /** @type {Array<number>} */
    this._size = [0, 0];

    /** @type {Array<number>} */
    this._transform = [0, 0];

    /** @type {HTMLCanvasElement} */
    this._canvas = deferred ? null : document.createElement("canvas");

    /** @type {CanvasRenderingContext2D} */
    this._context = deferred
      ? null
      : this._canvas.getContext("2d", { willReadFrequently: true });

    /** @type {Array<WebGLTexture>} */
    this._scaledMIPs = [];

    /** @type {number} */
    this._largestMIPScale = 0;

    /**
     * Ratio of the size of the SVG and the max size of the WebGL texture
     * @type {Number}
     */
    this._maxTextureScale = 1;
  }

  /**
   * Dispose of this object. Do not use it after calling this method.
   */
  dispose() {
    this.resetMIPs();
    super.dispose();
  }

  /**
   * @return {Array<number>} the natural size, in Scratch units, of this skin.
   */
  get size() {
    return [this._size[0], this._size[1]];
  }

  useNearest(scale, drawable) {
    // If the effect bits for mosaic, pixelate, whirl, or fisheye are set, use linear
    if (
      (drawable.enabledEffects &
        (ShaderManager.EFFECT_INFO.fisheye.mask |
          ShaderManager.EFFECT_INFO.whirl.mask |
          ShaderManager.EFFECT_INFO.pixelate.mask |
          ShaderManager.EFFECT_INFO.mosaic.mask)) !==
      0
    ) {
      return false;
    }

    // We can't use nearest neighbor unless we are a multiple of 90 rotation
    if (drawable._direction % 90 !== 0) {
      return false;
    }

    // Because SVG skins' bounding boxes are currently not pixel-aligned, the idea here is to hide blurriness
    // by using nearest-neighbor scaling if one screen-space pixel is "close enough" to one texture pixel.
    // If the scale of the skin is very close to 100 (0.99999 variance is okay I guess)
    // TODO: Make this check more precise. We should use nearest if there's less than one pixel's difference
    // between the screen-space and texture-space sizes of the skin. Mipmaps make this harder because there are
    // multiple textures (and hence multiple texture spaces) and we need to know which one to choose.
    if (
      Math.abs(scale[0]) > 99 &&
      Math.abs(scale[0]) < 101 &&
      Math.abs(scale[1]) > 99 &&
      Math.abs(scale[1]) < 101
    ) {
      return true;
    }
    return false;
  }

  /**
   * Create a MIP for a given scale.
   * @param {number} scale - The relative size of the MIP
   * @return {SVGMIP} An object that handles creating and updating SVG textures.
   */
  createMIP(scale, transform) {
    const isLargestMIP = this._largestMIPScale < scale;
    // TW: Silhouette will lazily read image data from our <canvas>. However, this canvas is shared
    // between the Skin and Silhouette so changing it here can mess up Silhouette. To prevent that,
    // we will force the silhouette to synchronously read the image data before we mutate the
    // canvas, unless the new MIP is the largest MIP, in which case doing so is unnecessary as we
    // will update the silhouette later anyways.
    if (!isLargestMIP) {
      this._silhouette.unlazy();
    }

    if (!transform) transform = [0, 0];
    if (!transform[0]) transform = [0, 0];
    if (!transform[1]) transform = [0, 0];

    // we scale up transform because 100% is a 45 degree angle (half the image width)
    // we also add 1 to it so this adds size ratther then remove size
    const tx = (transform[0] * 100) / 200 + 1;
    const ty = (transform[1] * 100) / 200 + 1;
    const [width, height] = this._size;
    this._canvas.width = width * scale * tx;
    this._canvas.height = height * scale * ty;
    if (
      this._canvas.width <= 0 ||
      this._canvas.height <= 0 ||
      // Even if the canvas at the current scale has a nonzero size, the image's dimensions are floored
      // pre-scaling; e.g. if an image has a width of 0.4 and is being rendered at 3x scale, the canvas will have
      // a width of 1, but the image's width will be rounded down to 0 on some browsers (Firefox) prior to being
      // drawn at that scale, resulting in an IndexSizeError if we attempt to draw it.
      this._svgImage.naturalWidth <= 0 ||
      this._svgImage.naturalHeight <= 0
    )
      return super.getTexture();
    this._context.clearRect(0, 0, this._canvas.width, this._canvas.height);
    // console.log(transform);
    this._context.setTransform(scale, transform[0], transform[1], scale, 0, 0);
    this._context.drawImage(this._svgImage, 0, 0);

    // TW: Reading image data from <canvas> is very slow and causes animations to stutter,
    // so we just use the canvas directly instead.
    const textureData = this._canvas;

    const textureOptions = {
      auto: false,
      wrap: this._renderer.gl.CLAMP_TO_EDGE,
      src: textureData,
      premultiplyAlpha: true,
    };

    const mip = twgl.createTexture(this._renderer.gl, textureOptions);

    // Check if this is the largest MIP created so far. Currently, silhouettes only get scaled up.
    if (isLargestMIP) {
      this._silhouette.update(textureData);
      this._largestMIPScale = scale;
    }

    return mip;
  }

  updateSilhouette(scale = [100, 100]) {
    // Ensure a silhouette exists.
    this.getTexture(scale);
    this._silhouette.unlazy();
  }

  /**
   * @param {Array<number>} scale - The scaling factors to be used, each in the [0,100] range.
   * @param {Array<number>} transform - The scaling factors to be used, each in the [0,100] range.
   * @return {WebGLTexture} The GL texture representation of this skin when drawing at the given scale.
   */
  getTexture(scale, transform) {
    // sometimes transform has undefined passed into it
    if (!transform) transform = [0, 0];
    if (typeof transform[0] !== "number") transform = [0, 0];
    if (typeof transform[1] !== "number") transform = [0, 0];

    // The texture only ever gets uniform scale. Take the larger of the two axes.
    const scaleMax = scale
      ? Math.max(Math.abs(scale[0]), Math.abs(scale[1]))
      : 100;
    const requestedScale = Math.min(scaleMax / 100, this._maxTextureScale);

    // Math.ceil(Math.log2(scale)) means we use the "1x" texture at (0.5, 1] scale,
    // the "2x" texture at (1, 2] scale, the "4x" texture at (2, 4] scale, etc.
    // This means that one texture pixel will always be between 0.5x and 1x the size of one rendered pixel,
    // but never bigger than one rendered pixel--this prevents blurriness from blowing up the texture too much.
    const mipLevel = Math.max(
      Math.ceil(Math.log2(requestedScale)) + INDEX_OFFSET,
      0,
    );
    // Can't use bitwise stuff here because we need to handle negative exponents
    const mipScale = Math.pow(2, mipLevel - INDEX_OFFSET);

    // this was split into 2 if statements because its hard to read
    if (this._svgImageLoaded) {
      // if there is no scaled mip for this level
      // or the passed in transform doesnt equal the current transform
      if (
        !(
          this._scaledMIPs[mipLevel] &&
          this.isTransformEqual(this._transform, transform)
        )
      ) {
        this._scaledMIPs[mipLevel] = this.createMIP(
          mipScale,
          transform || [0, 0],
        );
        this._transform = transform;
      }
    }

    return this._scaledMIPs[mipLevel] || super.getTexture();
  }

  /**
   * Checks the values of both transform arrays instead of the entire array.
   * This is because it causes some goofy bug if you check the entire array where they dont equal for some reason.
   * @param {Array<number>} transform
   * @param {Array<number>} checkingTransform
   */
  isTransformEqual(transform, checkingTransform) {
    if (!transform) return false;
    if (!checkingTransform) return false;
    let value = 0;
    if (transform[0] === checkingTransform[0]) value++;
    if (transform[1] === checkingTransform[1]) value++;
    return value === 2;
  }

  /**
   * Do a hard reset of the existing MIPs by deleting them.
   */
  resetMIPs() {
    this._scaledMIPs.forEach((oldMIP) =>
      this._renderer.gl.deleteTexture(oldMIP),
    );
    this._scaledMIPs.length = 0;
    this._largestMIPScale = 0;
  }

  /**
   * Desktop fork (section 164): parse the SVG and load its image when this skin is first needed.
   * @param {Function} getSvg - returns the SVG
   * @param {Array<number>} rotationCenter - rotation center of the SVG
   * @param {*} source - what the SVG comes from
   */
  deferSVG(getSvg, rotationCenter, source) {
    this._pmDefer(
      [
        "_svgImage",
        "_svgImageLoaded",
        "_canvas",
        "_context",
        "_size",
        "_rotationCenter",
        "_silhouette",
      ],
      () => {
        this.pmLoading = true;
        try {
          this.setSVG(getSvg(), rotationCenter);
        } catch (e) {
          log.warn("Costume could not be parsed", e);
          super.setEmptyImageData();
          this._pmLoaded();
        }
      },
      source,
    );
  }

  /**
   * Desktop fork (section 164): call back when the image of a skin that was put off has loaded.
   * @param {Function} callback - called then
   */
  pmWhenLoaded(callback) {
    (this._pmWaiting = this._pmWaiting || []).push(callback);
  }

  _pmLoaded() {
    this.pmLoading = false;
    const waiting = this._pmWaiting;
    this._pmWaiting = null;
    if (waiting) for (const callback of waiting) callback();
  }

  /**
   * Set the contents of this skin to a snapshot of the provided SVG data.
   * @param {string} svgData - new SVG to use.
   * @param {Array<number>} [rotationCenter] - Optional rotation center for the SVG. If not supplied, it will be
   * calculated from the bounding box
   * @fires Skin.event:WasAltered
   */
  setSVG(svgData, rotationCenter) {
    this._pmCancel();
    if (!this._svgImage) {
      this._svgImage = document.createElement("img");
      this._canvas = document.createElement("canvas");
      this._context = this._canvas.getContext("2d", {
        willReadFrequently: true,
      });
    }
    const svgTag = loadSvgString(svgData);
    const svgText = serializeSvgToString(svgTag, this._renderer.customFonts);
    this._svgImageLoaded = false;

    const { x, y, width, height } = svgTag.viewBox.baseVal;
    // While we're setting the size before the image is loaded, this doesn't cause the skin to appear with the wrong
    // size for a few frames while the new image is loading, because we don't emit the `WasAltered` event, telling
    // drawables using this skin to update, until the image is loaded.
    // We need to do this because the VM reads the skin's `size` directly after calling `setSVG`.
    // TODO: return a Promise so that the VM can read the skin's `size` after the image is loaded.
    this._size[0] = width;
    this._size[1] = height;

    this._svgImage.onerror = () => this._pmLoaded();
    // If there is another load already in progress, replace the old onload to effectively cancel the old load
    this._svgImage.onload = () => {
      if (width === 0 || height === 0) {
        super.setEmptyImageData();
        this._pmLoaded();
        return;
      }

      const maxDimension = Math.ceil(Math.max(width, height));
      const rendererMax = this._renderer.maxTextureDimension;
      let testScale = 2;
      for (testScale; maxDimension * testScale <= rendererMax; testScale *= 2) {
        this._maxTextureScale = testScale;
      }

      this.resetMIPs();

      if (typeof rotationCenter === "undefined")
        rotationCenter = this.calculateRotationCenter();
      // Compensate for viewbox offset.
      // See https://github.com/LLK/scratch-render/pull/90.
      this._rotationCenter[0] = rotationCenter[0] - x;
      this._rotationCenter[1] = rotationCenter[1] - y;

      this._svgImageLoaded = true;

      this.emitWasAltered();
      this._pmLoaded();
    };

    this._svgImage.src = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
  }
}

module.exports = SVGSkin;
