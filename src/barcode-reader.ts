import { BrowserMultiFormatOneDReader, HTMLCanvasElementLuminanceSource } from "@zxing/browser";
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource, Result } from "@zxing/library";

/** Rotate pixels without a canvas transform, preserving rectangular image dimensions. */
export class BarcodeLuminanceSource extends RGBLuminanceSource {
  isRotateSupported(): boolean { return true; }

  rotateCounterClockwise(): BarcodeLuminanceSource {
    const width = this.getWidth();
    const height = this.getHeight();
    const pixels = this.getMatrix();
    const rotated = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        rotated[(width - 1 - x) * height + y] = pixels[y * width + x];
      }
    }
    return new BarcodeLuminanceSource(rotated, height, width);
  }
}

export class OrientationAwareBarcodeReader extends BrowserMultiFormatOneDReader {
  decodeFromCanvas(canvas: HTMLCanvasElement): Result {
    // ZXing browser 0.2.1's canvas rotation fails to initialize its temporary canvas
    // and does not swap luminance dimensions. Its row decoder already handles
    // reversed barcodes; give it a correct quarter-turn for the other two directions.
    const pixels = new HTMLCanvasElementLuminanceSource(canvas).getMatrix();
    const source = new BarcodeLuminanceSource(pixels, canvas.width, canvas.height);
    return this.decodeBitmap(new BinaryBitmap(new HybridBinarizer(source)));
  }
}
