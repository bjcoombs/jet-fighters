// `.asm` files are modules, not assets.
//
// `tools/hmasm/vite-plugin.ts` assembles an assembly source on import and emits
// a module exporting the ROM image; this declaration is the type side of that
// contract, so `import { rom } from '../asm/jetfighter-hmcs44.asm'` type-checks under
// `tsc --noEmit` exactly as it resolves under Vite.

declare module '*.asm' {
  /** The assembled ROM image: `ROM_SIZE` ten-bit words, as `Memory` wants them. */
  export const rom: Uint16Array;
  /** Label and constant values, for naming an address in debug output. */
  export const symbols: Readonly<Record<string, number>>;
  /** Highest program-region address the assembly reached. */
  export const highestAddress: number;
  /** Highest static RAM nibble the assembly reserved. */
  export const ramHighWater: number;
  /** Absolute path of the entry source the image came from. */
  export const source: string;
  export default rom;
}
