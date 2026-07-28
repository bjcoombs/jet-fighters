# TMS1370 architecture - what is established, and how

Input to the v3 PRD for rebuilding the emulator on the processor the unit actually
contains. Scope is the CPU core: ROM, RAM, registers, instruction set, timing. Pin
assignments, the output PLA and the VFD interface are a separate document.

## How to read this

Every claim below carries a source. Sources fall into four confidence levels, and they
are not interchangeable:

| Level | Meaning | How it reads |
| ----- | ------- | ------------ |
| **Executable** | MAME's CPU implementation does this. It is the code that runs the real dumped MP2110 ROM. | "MAME implements ..." with a file and line |
| **Documented** | A TI manual states it. | "TI Dec 1976 manual §x states ..." with a page/section |
| **Inferred** | Derived by analogy or arithmetic from the two above. | Marked **inferred** inline |
| **Unestablished** | Not settled by anything read. | Listed in [What this does not settle](#what-this-does-not-settle) |

Where two sources agree, both are cited - that is the strongest position available here
and it is worth being explicit about which claims have it.

This document exists because the previous research did not do this. See
`docs/evidence/open-questions.md` §7: a generalisation about Gakken's chip supplier was
stacked onto a match between a marketing string and a datasheet, and neither was checked
against the chip in the photograph. The result was a complete emulator for the wrong
processor. **A confident sentence with nothing under it is the failure mode. An admitted
gap is not.**

## Sources

| # | Source | Type | Pinned at | Covers |
| - | ------ | ---- | --------- | ------ |
| S1 | MAME `src/devices/cpu/tms1000/` | Executable | commit `5c9450cb020402507b0a70f8aa7d84ef3611b400` (2026-07-28) | The core, as an interpreter |
| S2 | MAME `src/mame/handheld/hh_tms1k.cpp` | Executable | same commit | Which chip this is, its clock, its PLAs |
| S3 | *TMS 1000 Series Data Manual*, Texas Instruments, Dec 1976 | Documented | https://www.bitsavers.org/components/ti/TMS1000/TMS_1000_Series_Data_Manual_Dec76.pdf | TMS1000/1200/1070/1270 **and TMS1100/1300** |
| S4 | `assets/reference/tube-teardown/board-L1001567.jpg` | Physical | in-repo | The chip marking |

**S3 is the important find.** The Dec 1976 data manual is not only a TMS1000 document -
its §3 is *TMS 1100 and TMS 1300 Microcomputers*, and §4 is the shared electrical
specification for all four. Since MAME models the TMS1370 as a TMS1300 die with
high-voltage outputs (see below), S3 documents this chip's core directly, from TI, and is
not an analogy.

**S3 never names the TMS1370.** It is a 1976 document; the part is later. Everything that
is TMS1370-*specific* rather than TMS1100/1300-general rests on S1/S2 alone.

Two further sources were checked and are noted for completeness:

- *TMS1000 Programmer's Reference Manual*, 1975 -
  https://www.bitsavers.org/components/ti/TMS1000/TMS1000pgmRef_1975.pdf. **Scanned images
  with no text layer**; not read. This is the document that would settle the
  microinstruction PLA questions in the last section, and reading it is the single highest
  value follow-up available.
- *MP051 TMS 2100/2170/2300/2370 4-Bit Microcomputers*, TI, Jan 1982 -
  same directory. Successor family, not this chip. Not read.

## 1. Identification, and where the part sits in the family

| Claim | Source |
| ----- | ------ |
| The unit's chip is marked `MP2110`, `MSHL△8040`, TI logo, 40-pin DIP | S4 |
| `MP2110` is a TMS1370, used in *Gakken Invader / Tandy Fire Away*, 1980 | S2 `hh_tms1k.cpp:131` |
| Its die label is `1370` - it is physically a TMS1370 die, not a relabelled sibling | S2 `hh_tms1k.cpp:7003` |
| The TMS1370 is the high-voltage version of the TMS1300, and also appears in a 28-pin package with some O/R pins unavailable | S2/S1 `tms1100.cpp:23` |
| The TMS1370 shares the **TMS1100 core** - MAME's `tms1370_cpu_device` derives from `tms1100_cpu_device` and adds nothing but a device type and a pin count | S1 `tms1100.h:93-97`, `tms1100.cpp:42-44` |

The die-label point is worth keeping. Two of the three sibling masks named in the brief
carry a different die label from their emulated type: MP2105 and MP2139 are both `1170`
dies emulated as TMS1370 (S2 `hh_tms1k.cpp:6721`, `7134`). MP2110 is a `1370` die emulated
as a TMS1370. The identification of *our* chip does not depend on MAME having got the
other two right.

### What the TMS1370 is, constructively

MAME constructs it with exactly these parameters (S1 `tms1100.cpp:42-44`), and this line
is the densest single statement of the architecture available:

```cpp
tms1370_cpu_device::tms1370_cpu_device(...) :
    tms1100_cpu_device(mconfig, TMS1370, tag, owner, clock,
        8,   // o pins
        16,  // r pins
        6,   // pc bits
        8,   // byte (instruction word) width
        3,   // x register width
        1,   // stack levels
        11,  // rom address width  -> 2048 x 8
        rom_11bit,
        7,   // ram address width  -> 128 x 4
        ram_7bit)
```

Compare the siblings, all from the same file:

| Part | O pins | R pins | X bits | Stack | ROM | RAM | Package | Source |
| ---- | ------ | ------ | ------ | ----- | --- | --- | ------- | ------ |
| TMS1000 | 8 | 11 | 2 | 1 | 1024×8 | 64×4 | 28-pin | `tms1000.cpp:43` |
| TMS1100 | 8 | 11 | 3 | 1 | 2048×8 | 128×4 | 28-pin | `tms1100.cpp:31` |
| TMS1300 | 8 | 16 | 3 | 1 | 2048×8 | 128×4 | 40-pin | `tms1100.cpp:39` |
| **TMS1370** | **8** | **16** | **3** | **1** | **2048×8** | **128×4** | **40-pin** | `tms1100.cpp:43` |
| TMS1400 | 8 | 11 | 3 | **3** | **4096×8** | 128×4 | 28-pin | `tms1400.cpp:38` |

So: **TMS1370 = TMS1300 core and memory, in the same 40-pin pinout, with high-voltage
outputs.** The high-voltage part is why it is in a VFD game - it drives the tube's grids
and plates without external level shifting. That is the whole of what distinguishes it,
in MAME's model.

The TMS1400's extra ROM and 3-level stack are listed only to make clear what the TMS1370
does **not** have. One stack level is a hard constraint on the program to be written.

TI's own framing of the TMS1100/1300, for the same facts from the other side:

> Texas Instruments increased the four-bit microprocessor capability with an expanded
> one-chip microcomputer containing all of the TMS 1000 features plus twice the ROM and
> RAM capacity. [...] The TMS 1100/1300 operation is identical to that of the TMS
> 1000/1200 except where noted otherwise. (S3 §3.1)

listing for the TMS1300: 16,384-bit ROM, 512-bit RAM, 16 individually latched R outputs,
40-pin package (S3 §3.1).

**Agreement**: 2048×8 ROM and 128×4 RAM are stated by both S1 and S3. 16 R outputs on the
40-pin part likewise. These are the safest claims in this document.

## 2. ROM: size, organisation, and how paging constrains branches

### Organisation

| Fact | Source |
| ---- | ------ |
| 2048 words of 8 bits; the address space is 11 bits wide | S1 `tms1k_base.cpp:293-296` (`rom_11bit` maps `0x000-0x7ff`), S3 §3.1 ("16,384-bit ROM, 2048 eight-bit instruction words") |
| Organised as **2 chapters × 16 pages × 64 words** | S3 §3.2, and S1 `tms1k_base.cpp:620` computes the address as `(CA << 10) \| (PA << 6) \| PC` |
| One instruction = one 8-bit word. There are no multi-word instructions | S3 §2.8 ("All instructions are executed in one instruction cycle"), S1 - `read_opcode` reads a single byte and the disassembler always returns length 1 (`tms1k_dasm.cpp:427`) |

The address is assembled as:

```
bit:   10   9  8  7  6   5  4  3  2  1  0
      [CA] [ P A    ] [    P C        ]
       ^chapter ^page   ^program counter (LFSR, see below)
```

(S1 `tms1k_base.cpp:620`: `m_rom_address = (m_ca << (m_pc_bits+4)) | (m_pa << m_pc_bits) | m_pc;`)

### The program counter is an LFSR, not a counter

This is the detail most likely to break an assembler written from a mental model of a
normal CPU.

The 6-bit PC is a linear-feedback shift register (S1 `tms1k_base.cpp:324-337`; S3 §2.2
calls it "a shift-register program counter"). It visits all 64 states of a page, but not
in numeric order. Executing straight-line code from the start of a page walks these
*physical* word addresses in order:

```
00 01 03 07 0F 1F 3F 3E 3D 3B 37 2F 1E 3C 39 33 27 0E 1D 3A 35 2B 16 2C
18 30 21 02 05 0B 17 2E 1C 38 31 23 06 0D 1B 36 2D 1A 34 29 12 24 08 11
22 04 09 13 26 0C 19 32 25 0A 15 2A 14 28 10 20
```

(computed from S1 `tms1k_base.cpp:324-337`; all 64 states are visited exactly once, so the
mapping is a bijection and invertible. MAME's disassembler builds the same two tables -
`pc_linear_to_real` / `pc_real_to_linear`, `tms1k_dasm.cpp:19-40, 72-82`.)

Two consequences for the toolchain:

1. **A ROM image is not laid out in execution order.** The assembler must place the *n*-th
   instruction of a page at physical offset `lfsr[n]`, and a disassembler must walk the
   LFSR to read code in order.
2. **A branch operand is an LFSR state, not an instruction ordinal.** `op_br1` sets
   `m_pc = m_opcode & 0x3f` directly (S1 `tms1k_base.cpp:412`) - the low 6 bits of the
   opcode are loaded into the shift register as-is. A label at the *n*-th slot of a page
   assembles to `lfsr[n]`, not to `n`.

### Branches and calls, and the page/chapter rules

`BR` is `0x80-0xBF`, `CALL` is `0xC0-0xFF` (S1 `tms1000.cpp:141-142`); both are
**conditional on status** and both carry a 6-bit destination within a page. There is no
unconditional jump instruction and no long jump. Status is 1 unless the preceding
instruction cleared it, so an unconditional branch is written by simply not clearing
status first (S3 §2.9: "If an instruction that does not affect status is placed between an
instruction that does affect status and a branch or call instruction, then the branch or
call is always successful").

Changing page is a **two-instruction sequence**: `LDP <page>` loads the page *buffer* PB,
and PB transfers into the page *address* PA only on a successful branch or call (S3 §2.2;
S1 `op_ldp` at `tms1k_base.cpp:571-575`, `op_br1`/`op_call1` at `404-446`). Same for
chapter: `COMC` complements the chapter buffer CB, which transfers into CA on a successful
branch or call (S3 §3.2; S1 `op_comc` at `577-581`).

Now the part that has bitten this project before, on a different chip. From `op_br1`
(S1 `tms1k_base.cpp:404-414`):

```cpp
void tms1k_base_device::op_br1()
{
    if (m_status)
    {
        if (m_clatch == 0)      //  <-- only outside a subroutine
            m_pa = m_pb;
        m_ca = m_cb;
        m_pc = m_opcode & m_pc_mask;
    }
}
```

**Inside a subroutine (call latch set), a branch cannot change page.** PA is not reloaded
from PB. The chapter *can* still change, because `m_ca = m_cb` is unconditional. So a
subroutine's reachable code is one page number, in either chapter - 128 words.

S3 states the same thing from TI's side, and the two agree:

> Since the buffer bit is changeable without affecting the chapter subroutine-return
> address, up to 128 words that are contained on two pages of alternate chapters are
> available in a single subroutine. (S3 §3.2)

This is a **rule the assembler should enforce**, not a fact to be remembered by whoever
writes the game: a `BR` between pages inside a subroutine assembles cleanly and silently
jumps to the wrong place.

### The subroutine stack is one level, and overflow is silent

| Fact | Source |
| ---- | ------ |
| One level. `stack_levels = 1` selects `op_call1`/`op_retn1` | S1 `tms1100.cpp:43`, `tms1k_base.h:159-161` |
| Return address is a single 6-bit register SR plus a chapter latch CS; the return *page* is held in PB | S1 `op_call1`, `tms1k_base.cpp:428-446`; S3 §2.2 ("One level of subroutine return address is stored in the subroutine return register [...] The page buffer register also holds the return page address in the call subroutine mode") |
| **A CALL executed while already inside a subroutine does not save a return address.** It branches, sets PA from PB and PB to the old PA, and leaves SR untouched | S1 `tms1k_base.cpp:434-444` - the save is guarded by `if (!m_clatch)` |
| `RETN` when not in a subroutine does not restore PC; it still does `m_pa = m_pb` | S1 `tms1k_base.cpp:474-486` |

So nesting does not overflow a stack - it silently loses the outer return address. **This
is a second thing the assembler or a runtime check should catch**, because the failure is
a wild jump much later, not a fault at the call site.

## 3. RAM

| Fact | Source |
| ---- | ------ |
| 128 four-bit words (512 bits), addressed 7 bits wide | S1 `tms1100.cpp:43` (`ram_width 7`), `tms1k_base.cpp:308-311`; S3 §3.1, §3.3 |
| Organised as **8 files × 16 words**; X selects the file, Y selects the word | S3 §3.3; S1 `tms1k_base.cpp:724` - `m_ram_address = m_x << 4 \| m_y` |
| X is 3 bits on this core (2 on the TMS1000) | S1 `tms1100.cpp:43` (`x_bits 3`); S3 §3.3 ("the X register (three bits long) selects one of eight possible files") |
| There is no other addressing mode. Every memory access is at `X:Y` | S1 - `m_ram_address` is written in exactly one place, `tms1k_base.cpp:724` |
| RAM contents at power-up are undefined | Not stated by S1 or S3 - see [What this does not settle](#what-this-does-not-settle) |

Individual bits are reachable: `SBIT`, `RBIT` and `TBIT` take a 2-bit index and set, clear
or test one bit of the addressed nibble (S1 `op_sbit`/`op_rbit` at `tms1k_base.cpp:510-524`;
S3 §3.2 Table 3).

**Constraint worth carrying into the PRD**: `SETR` and `RSTR` address an R output by Y, and
S3 §3.3 states "When using the set or reset R instructions, the X register must be less
than four." MAME implements the TMS1100-family override as
`index = BIT(X, 2) << 4 | Y` (S1 `tms1100.cpp:77-92`), i.e. it uses X's MSB as a fifth
index bit. On a 16-R part all 16 outputs are reachable with X < 4, so the two are
consistent here; the fifth bit only matters on parts with more than 16 R pins. But it
means **X is not free at the moment an R output is written** - a display sweep that keeps
its state in file 4-7 will address the wrong R line.

## 4. Register set

All from S1 `tms1k_base.h:210-235` unless noted; widths for this part follow from the
constructor parameters in §1.

| Register | Width | Role | Notes |
| -------- | ----- | ---- | ----- |
| A | 4 | Accumulator | ALU destination, RAM source/destination, low 4 bits of the O register |
| Y | 4 | RAM word address; ALU operand and destination; R-output index | The busiest register on the chip |
| X | 3 | RAM file address | Set by `LDX` (constant) or `COMX` (complement MSB only, see §5) |
| PC | 6 | Program counter within a page | LFSR, §2 |
| PA | 4 | Page address | Current page |
| PB | 4 | Page buffer | Loaded by `LDP`; transfers to PA on a taken branch/call; **also holds the return page** |
| SR | 6 | Subroutine return | One level |
| CA | 1 | Chapter address | 1 bit used of the 2048-word space |
| CB | 1 | Chapter buffer | Toggled by `COMC` |
| CS | 1 | Chapter subroutine | Saved/restored with SR |
| Status | 1 | Condition flag | Set to 1 at the start of every instruction and cleared only by the instruction itself (S1 `tms1k_base.cpp:651, 699`); S3 §2.4, §2.9 |
| Status latch | 1 | Latched status | Loaded by the `STSL` microinstruction; supplies the 5th bit of the O-register index (S1 `op_tdo`, `tms1k_base.cpp:540-544`) |
| O register | 5 in / 8 out | Output | Index is `status_latch << 4 \| A`, decoded through the output PLA. I/O document's territory |
| R latches | 16 | Output | Set/reset individually by `SETR`/`RSTR` |

There is **no general-purpose register file, no index register beyond X/Y, no stack
pointer, and no interrupt** anywhere in this core. A `HALT` and interrupt instructions
exist in the family's later SMC1102 table (S1 `tms1k_dasm.cpp:280`) but not on the TMS1100
core.

`m_clatch` (call latch) is not a programmer-visible register but determines the branch and
call semantics of §2, so it must be modelled.

## 5. Instruction set

### The shape of the encoding

Opcodes are 8 bits, in two halves (S1 `tms1000.cpp:113-143`, `tms1100.cpp:62-73`):

- **Fixed instructions** - hard-wired in silicon, identical on every TMS1100-family mask.
- **Microinstruction-defined instructions** - decoded through the *microinstructions PLA*,
  a 30-term, 16-output array (S1 `tms1000.cpp:94`) that is **mask-programmable per
  customer**. S3 §2.7 is explicit:

  > The programmable instruction decode is defined by the instruction PLA. [...] As an
  > example, the "add eight to the accumulator, results to accumulator" instruction can be
  > modified to perform a "add eight to the Y register, result to Y" instruction.

This is the single most important caveat in this document, and §7 of this file returns to
it. **The "TMS1100 standard instruction set" is a default, not the architecture.**

The fixed half of the map on the TMS1100 core (S1 `tms1000.cpp:129-142` as modified by
`tms1100.cpp:66-72`):

| Opcode | Instruction | Notes |
| ------ | ----------- | ----- |
| `0x09` | `COMX` | Complements **only the MSB of X** on this core (S3 Table 3: "Complement the MSB of X"; S1 `op_comx8`, `tms1k_base.cpp:564-569`). On the TMS1000 it complements all of X. |
| `0x0A` | `TDO` | A + status latch → O register |
| `0x0B` | `COMC` | Complement chapter buffer. **The TMS1000's `CLO` is not present on this core** (S1 `tms1100.cpp:69` replaces it) |
| `0x0C` | `RSTR` | Reset R output selected by Y |
| `0x0D` | `SETR` | Set R output selected by Y |
| `0x0F` | `RETN` | |
| `0x10-0x1F` | `LDP k` | Load page buffer |
| `0x28-0x2F` | `LDX k` | Load X (3-bit constant) |
| `0x30-0x33` | `SBIT b` | |
| `0x34-0x37` | `RBIT b` | |
| `0x80-0xBF` | `BR a` | Conditional, 6-bit target |
| `0xC0-0xFF` | `CALL a` | Conditional, 6-bit target |

Everything else - `0x00-0x08`, `0x0E`, `0x20-0x27`, `0x38-0x3F`, `0x40-0x7F` - comes out
of the microinstruction PLA.

There is no `CLO` on this core, so clearing the O register means executing `TDO` with A=0
and the status latch clear.

### The standard TMS1100 opcode map

MAME's disassembler table (S1 `tms1k_dasm.cpp:177-198`). **This is the standard set, which
MAME's disassembler assumes unconditionally** - it does not consult the mPLA. Read it as
"what a TMS1100 does if its mPLA is the standard one":

| | `_0` | `_1` | `_2` | `_3` | `_4` | `_5` | `_6` | `_7` | `_8` | `_9` | `_A` | `_B` | `_C` | `_D` | `_E` | `_F` |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| **`0_`** | MNEA | ALEM | YNEA | XMA | DYN | IYC | AMAAC | DMAN | TKA | COMX | TDO | COMC | RSTR | SETR | KNEZ | RETN |
| **`1_`** | LDP × 16 | | | | | | | | | | | | | | | |
| **`2_`** | TAY | TMA | TMY | TYA | TAMDYN | TAMIYC | TAMZA | TAM | LDX × 8 → | | | | | | | |
| **`3_`** | SBIT × 4 → | | | | RBIT × 4 → | | | | TBIT × 4 → | | | | SAMAN | CPAIZ | IMAC | MNEZ |
| **`4_`** | TCY k × 16 | | | | | | | | | | | | | | | |
| **`5_`** | YNEC k × 16 | | | | | | | | | | | | | | | |
| **`6_`** | TCMIY k × 16 | | | | | | | | | | | | | | | |
| **`7_`** | A1ACC…A15ACC in bit-reversed order (`0x70-0x7E`), CLA (`0x7F`) | | | | | | | | | | | | | | | |
| **`8_`-`B_`** | BR (64 targets) | | | | | | | | | | | | | | | |
| **`C_`-`F_`** | CALL (64 targets) | | | | | | | | | | | | | | | |

`0x70-0x7E` decode as `AnACC` - add *n* to the accumulator - where *n* is the bit-reversed
operand plus 1 (S1 `tms1k_dasm.cpp:397-402`). Those 15 opcodes cover every non-zero addend
1-15 exactly once, in scrambled order:

| Opcode | `70` | `71` | `72` | `73` | `74` | `75` | `76` | `77` | `78` | `79` | `7A` | `7B` | `7C` | `7D` | `7E` | `7F` |
| - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - | - |
| Adds | 1 | 9 | 5 | 13 | 3 | 11 | 7 | **15** | 2 | 10 | 6 | 14 | 4 | 12 | 8 | CLA |

TI's Table 3 names two of these separately: `IAC` (increment accumulator) is `A1ACC` at
`0x70`, and `DAN` (decrement accumulator) is `A15ACC` at `0x77` - adding 15 is subtracting
1 in four bits. There is no missing decrement instruction, and there is no `A0ACC`; `0x7F`
is `CLA`. TI spells the family `AnAAC`, MAME prints `AnACC`; same instruction.

TI's Table 3 (S3 §3.2) lists the same mnemonics with descriptions. Cross-checking the two
found **no disagreement** on any mnemonic present in both, including the two places where
the TMS1100 differs from the TMS1000 (`COMX` as MSB-only, `COMC` replacing `CLO`). TI's
table does not give opcode values, so the *encoding* above rests on S1 alone; the
*semantics* have both.

By function, from S3 §3.2 Table 3:

| Group | Instructions |
| ----- | ------------ |
| Register transfer | `TAY` `TYA` `CLA` |
| Register → memory | `TAM` `TAMIYC` `TAMDYN` `TAMZA` |
| Memory → register | `TMY` `TMA` `XMA` |
| Arithmetic | `AMAAC` `SAMAN` `IMAC` `DMAN` `IAC` `DAN` `A2AAC`…`A14AAC` `IYC` `DYN` `CPAIZ` |
| Compare | `ALEM` `MNEA` `MNEZ` `YNEA` `YNEC` |
| Bit | `SBIT` `RBIT` `TBIT1` |
| Constant | `TCY` `TCMIY` |
| Input | `KNEZ` `TKA` |
| Output | `SETR` `RSTR` `TDO` |
| RAM X addressing | `LDX` `COMX` |
| ROM addressing | `BR` `CALL` `RETN` `LDP` `COMC` |

### Operand encoding is bit-reversed

Constant and index operands are stored **bit-reversed** in the opcode. MAME computes
`m_c4 = bitswap<4>(m_opcode, 0,1,2,3)` on every fetch (S1 `tms1k_base.cpp:343`) and the
disassembler carries reversal tables for 2-, 3- and 4-bit operands (S1
`tms1k_dasm.cpp:377-390`).

On this core it applies to `LDP` (4-bit), `LDX` (3-bit), `TCY`, `YNEC`, `TCMIY` (4-bit),
the `AnACC` family, and the `SBIT`/`RBIT`/`TBIT` bit index (2-bit). It does **not** apply
to the branch/call target, which is the raw low 6 bits (S1 `tms1k_base.cpp:412`).

An assembler that emits operands unreversed will produce a ROM that assembles, disassembles
under a naive disassembler, and computes the wrong numbers.

### Status semantics

Status is 1 by default and is driven to 0 for exactly one instruction cycle by a failed
condition (S1 `tms1k_base.cpp:651` initialises `status = 1` per instruction and only ANDs it
down; S3 §2.4, §2.9). A branch or call is taken when status is 1.

The practical consequence, stated by TI (S3 §2.9) and reproduced by MAME's per-instruction
reset of status: **the test and the branch must be adjacent.** Any instruction that does
not affect status placed between them makes the branch unconditional.

## 6. Timing

| Fact | Source |
| ---- | ------ |
| **Six oscillator pulses = one instruction cycle. Every instruction takes exactly one instruction cycle.** | S3 §2.8, verbatim: "Six oscillator pulses constitute one instruction cycle. All instructions are executed in one instruction cycle." **And** S1 - `execute_run` advances a 6-state subcycle counter and decrements the cycle count once per subcycle (`tms1k_base.cpp:734-743`) |
| A full instruction spans 12 oscillator pulses across a fetch phase and an execute phase; the two are pipelined, so throughput is one instruction per 6 | S1 `tms1k_base.cpp:12-49` (the file header enumerates what happens in each of the six) |
| Oscillator range 100-400 kHz; clock cycle time 2.5 µs min / 3 µs typ / 10 µs max | S3 §4 (recurring electrical table, identical across TMS1000/1200, TMS1070/1270 and TMS1100/1300) |
| Instruction cycle time tc: **15 µs min, 60 µs max** | S3 §4 |
| The oscillator is an on-chip RC oscillator, set by an external R and C on OSC1/OSC2, or driven externally | S3 §2.8, §4 |

15 µs × 400 kHz = 6 pulses exactly; the electrical table is internally consistent with §2.8,
and MAME's 6-subcycle loop is consistent with both. **This is the one number in the
document with three independent confirmations.**

### What that means for this unit

MAME clocks *Gakken Invader* at 350 kHz, and labels it an estimate:

```cpp
TMS1370(config, m_maincpu, 350000); // approximation - RC osc. R=47K, C=47pF
```

(S2 `hh_tms1k.cpp:7093`.) At that figure:

| Quantity | Value |
| -------- | ----- |
| Oscillator | 350 kHz (**estimated**, not measured) |
| Instruction rate | 350000 / 6 = **58,333 instructions/s** |
| Instruction period | **17.14 µs** |
| Instructions in one 60 Hz frame | ≈ 972 |

Two cautions:

1. **350 kHz is MAME's guess, and the R/C values in that comment are a guess about a guess.**
   The sibling drivers use 375 kHz (MP2105, `hh_tms1k.cpp:6842`) and 425 kHz (MP1604,
   `hh_tms1k.cpp:7361`) with the same "approximation" wording.

   The error is not merely unquantified - MAME quantifies it, and it is large. The driver's
   own header (S2 `hh_tms1k.cpp:19-24`) says:

   > About the approximated MCU frequency everywhere: The RC osc. is not that stable on most
   > of these handhelds. When comparing multiple video recordings of the same game, it
   > shows(and sounds) that the frequency range can differ up to 50kHz. This is probably
   > exaggerated due to components getting worn out after many decades.

   **±50 kHz on 350 kHz is ±14%**, unit to unit, and MAME attributes part of it to ageing -
   which means the *owner's* unit has its own figure and no other unit's figure substitutes
   for it.
2. This project has already been burned by deriving an audio divisor from an assumed sweep
   rate (`docs/evidence/open-questions.md` §7, item 2). **The instruction rate is the input
   to every cadence and pitch calculation in the new ROM, and it is currently the least
   certain number in this document.** Measuring it from the recordings - a known-period
   program event against the audio timebase - would replace an estimate with a measurement,
   and is worth doing before any cadence is chosen.

## 7. Reset and power-up

| Fact | Source |
| ---- | ------ |
| Execution begins at **chapter 0, page 15, PC 0** - physical ROM address `0x3C0` | S1 `tms1k_base.cpp:245-253`: reset sets `m_pa = m_pb = 0xf`, `m_pc = 0`, `m_ca = m_cb = 0`; address composition at `:620` |
| S3 says only "After power-up the program execution starts at a fixed instruction address" - it does not name the address in the text read | S3 §2.2 |
| At reset the R outputs are cleared and the O register is written with index 0 | S1 `tms1k_base.cpp:266-271` |
| Status is 0 at reset, and the call latch is clear | S1 `tms1k_base.cpp:254-259` |
| The INIT pin is the reset input | S1 `tms1100.h:47` (pinout), `tms1k_base.h:36-37` |
| RAM is **not** cleared at reset by MAME - `device_reset` touches no RAM | S1 `tms1k_base.cpp:245-272` |

The page-15 entry point matters for ROM layout: the reset vector is 64 words from the end
of chapter 0, not at address 0.

## What this does not settle

Ranked by how much it would change the PRD.

### 1. Whether MP2110's instruction set is the standard TMS1100 set

**The most consequential gap.** The microinstruction PLA is mask-programmable (S3 §2.7),
and MAME loads a specific one for this chip:

```
ROM_REGION( 867, "maincpu:mpla", 0 )
ROM_LOAD( "tms1100_common2_micro.pla", 0, 867, CRC(7cc90264) SHA1(c6e1cf1ffb178061da9e31858514f7cd94e86990) )
```

(S2 `hh_tms1k.cpp:7118-7119`.) Notes on this:

- MAME distinguishes at least four TMS1100 micro PLAs - `common1` through `common4` (S2,
  across `hh_tms1k.cpp`; `common2` is used by 30 sets and `common1` by 21). They are not
  all the same instruction set.
- **The MP2110 entry is not marked `BAD_DUMP`**, where other sets using the same file are
  (e.g. `hh_tms1k.cpp:950`, `:1818`, both "// not verified"). By MAME convention that means
  verified. **Do not lean on it harder than that**: the driver's own TODO list reads
  "Verify output PLA and microinstructions PLA for MCUs that have been dumped
  electronically (mpla is usually the default, opla is often custom)" (S2
  `hh_tms1k.cpp:49-50`). So MAME itself treats "this chip uses the standard micro PLA" as a
  working assumption across the driver, and the unflagged entry is weaker evidence than the
  flag alone suggests.
- Either way the instruction set of this exact chip is a fact *that exists in a file this
  document has not read*.
- MAME's **disassembler ignores the PLA entirely** and always prints the standard TMS1100
  mnemonics (S1 `tms1k_dasm.cpp:50, 177-198`). A disassembly of `mp2110` therefore cannot
  be trusted for any microinstruction-defined opcode until the PLA is checked.

**What would settle it**: obtain `tms1100_common2_micro.pla` (it ships in the `ginv` MAME
romset, 867 bytes, Berkeley PLA format per S1 `tms1000.cpp:94`), run it through MAME's
`decode_micro` logic (S1 `tms1000.cpp:145-158`) for all 256 opcodes, and compare the
resulting microinstruction sets against the standard table in §5. That is a mechanical
check and it is a prerequisite for writing a single line of assembly.

Until then, treat §5's opcode map as **standard-set, unverified for this mask** -
Documented for semantics, Executable for encoding, and Inferred for "this chip does that".

### 2. The actual oscillator frequency

350 kHz is MAME's approximation (§6), and the family's real-world spread is ±50 kHz
between units of the same model. Nothing measured underlies the figure for this unit.

**What would settle it**: measure it on the unit, or infer it from the reference recordings
by timing a program event of known instruction count against the audio timebase. The second
route is the one this project is already equipped for, and it produces a number for *this*
unit rather than for the model.

Reading the RC values off `assets/reference/tube-teardown/board-L1001567.jpg` is a weaker
fallback than it sounds: S3 §4 charts typical internal-oscillator frequency, but MAME notes
"TMS1000 RC curve is documented in the data manual, but not for newer ones" (S2
`hh_tms1k.cpp:23-24`), and the TMS1370 is a newer one. It would give an order of magnitude,
not a frequency.

### 3. Power-up RAM state

MAME does not clear RAM at reset, and neither S1 nor S3 says what the hardware does.
The current project treats RAM as undefined at power-on and cleared by the ROM
(`CLAUDE.md`, "The power switch is the only reset"), which is the safe assumption on any
mask-ROM MCU, but it is **inferred**, not sourced.

**What would settle it**: the 1975 programmer's reference (scanned, unread), or the
observed behaviour of the real MP2110 ROM's first instructions.

### 4. Whether the TMS1370 differs from the TMS1300 in any way MAME does not model

MAME's `tms1370_cpu_device` adds a device type and nothing else (S1 `tms1100.cpp:42-44`),
so within MAME the two are the same core. The high-voltage output stage is an electrical
difference MAME does not need to model, and would not affect the core. But **no TI document
naming the TMS1370 was found** - S3 predates it. If the part has any core-visible
difference from the TMS1300, nothing read here would reveal it.

**What would settle it**: a TI data sheet or data manual from 1978-1982 that lists the
TMS1370. Bitsavers' `components/ti/TMS1000/` holds five documents and none of them is one
(directory listing read 2026-07-28).

### 5. The exact reset entry point on real silicon

MAME starts at `0x3C0` (page 15, word 0). S3 says "a fixed instruction address" without
naming it. The two are consistent but only one of them is specific.

**What would settle it**: the programmer's reference, or observing where the real MP2110
ROM's first executed instruction lies.

### 6. Documented behaviour of degenerate cases

Not stated by either source, and MAME's behaviour may be its own choice rather than the
chip's:

- `CALL` while already inside a subroutine (MAME: branches, discards the return address).
- `RETN` while not inside a subroutine (MAME: no PC restore, but `PA = PB` still happens).
- `SETR`/`RSTR` with X ≥ 4 (S3 says the programmer must not; MAME defines a behaviour).

Each is a case the new ROM should simply never produce, and the assembler is the right
place to make that true. Listed here so the PRD treats them as *avoided*, not as
*understood*.
