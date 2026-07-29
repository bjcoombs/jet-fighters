// `.asm` files are modules, not assets.
//
// `tools/tmsasm/vite-plugin.ts` assembles an assembly source on import and emits
// a module exporting the machine image; this declaration is the type side of
// that contract, so `import { rom, opla } from '../asm/jetfighter.asm'`
// type-checks under `tsc --noEmit` exactly as it resolves under Vite.

declare module '*.asm' {
  /** The assembled ROM image: `ROM_WORD_COUNT` eight-bit words. */
  export const rom: Uint8Array;
  /**
   * The 32-slot O output PLA, one eight-bit plate mask per slot.
   *
   * Mask-programmed data rather than executed words, which is why it is a
   * separate export rather than an appendix to the ROM: the core's O state is a
   * five-bit index and this table is what turns it into plate lines.
   */
  export const opla: Uint8Array;
  /** Label and constant values, for naming an address in debug output. */
  export const symbols: Readonly<Record<string, number>>;
  /** Highest program-region address the assembly reached. */
  export const highestAddress: number;
  /** Highest static RAM nibble the assembly reserved. */
  export const ramHighWater: number;
  /** True when the assembly placed a routine at the reset vector. */
  export const resetVectorPresent: boolean;
  /** Absolute path of the entry source the image came from. */
  export const source: string;
  export default rom;
}
