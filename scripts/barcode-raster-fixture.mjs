// Synthetic EAN-13 pixels for decoder tests. No network, DOM, camera or food data.
const left = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const odd = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const parity = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

export function barcodeRaster(code, angle, width = 480, height = 640, offsetX = 0, offsetY = 0) {
  let bits = '101';
  for (let i = 1; i < 7; i++) bits += (parity[+code[0]][i - 1] === 'L' ? left : odd)[+code[i]];
  bits += '01010';
  for (let i = 7; i < 13; i++) bits += left[+code[i]].replace(/[01]/g, x => x === '1' ? '0' : '1');
  bits += '101';
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2 - offsetX, dy = y - height / 2 - offsetY;
      const labelX = cos * dx + sin * dy;
      const labelY = -sin * dx + cos * dy;
      const bit = Math.floor((labelX + bits.length * 3 / 2) / 3);
      if (Math.abs(labelY) < 50 && bits[bit] === '1') {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { width, height, data, getContext: () => ({ getImageData: () => ({ data }) }) };
}
