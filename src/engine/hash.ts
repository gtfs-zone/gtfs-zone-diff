/** 53-bit hashes for signatures: equal inputs give equal numbers. */

/** A running hash: feed strings and numbers, then read `value`. */
export class Hasher {
  private h1 = 0xdeadbeef;
  private h2 = 0x41c6ce57;

  reset(): this {
    this.h1 = 0xdeadbeef;
    this.h2 = 0x41c6ce57;
    return this;
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) {
      this.mix(s.charCodeAt(i));
    }
    // A separator, so "ab" + "c" and "a" + "bc" differ.
    return this.mix(0x1f);
  }

  num(n: number): this {
    return this.mix(n | 0).mix((n / 4294967296) | 0);
  }

  private mix(c: number): this {
    this.h1 = Math.imul(this.h1 ^ c, 2654435761);
    this.h2 = Math.imul(this.h2 ^ c, 1597334677);
    return this;
  }

  get value(): number {
    let h1 = Math.imul(this.h1 ^ (this.h1 >>> 16), 2246822507);
    h1 ^= Math.imul(this.h2 ^ (this.h2 >>> 13), 3266489909);
    let h2 = Math.imul(this.h2 ^ (this.h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
}
