export class PcmStreamParser {
  private remainder: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Float32Array {
    const data =
      this.remainder.length > 0
        ? Buffer.concat([this.remainder, chunk])
        : chunk;
    const byteLength = data.length - (data.length % 4);
    this.remainder = data.subarray(byteLength);
    const values = new Float32Array(byteLength / 4);
    for (let index = 0; index < values.length; index += 1)
      values[index] = data.readFloatLE(index * 4);
    return values;
  }

  reset(): void {
    this.remainder = Buffer.alloc(0);
  }
}
