# TMS1370 I/O, the display path, and the MAME machine that shares our mask

Research for the v3 rebuild. This document covers **how a TMS1370 drives a vacuum
fluorescent tube and reads its controls**, and what MAME's driver for our unit's exact
ROM mask says about our machine. The CPU core itself - instruction set, registers, RAM,
ROM paging - is the subject of a separate document and is deliberately not covered here.

Context for why this exists: `docs/evidence/open-questions.md` section 7. This project
emulated a Hitachi HMCS44 for its whole life because a PRD inferred a chip from a
manufacturer generalisation and a marketing string, rather than reading the one in the
photograph. So the discipline here is that **every claim carries a source, and every
claim without one says so**.

## How to read the source column

| Marking | Meaning |
| --- | --- |
| **Code** | Quoted from a named file at a named line. Verifiable by reading it. |
| **Datasheet** | Quoted from TI's own published documentation. |
| **Photo** | Read off `assets/reference/tube-teardown/board-L1001567.jpg` by counting or reading text in the image. Counts carry their own uncertainty. |
| **Inferred** | Follows from the above by argument. The argument is given so it can be attacked. |
| **Unknown** | Stated so it is not mistaken for settled. Collected in "What this does not settle". |

Sources used throughout:

- MAME `src/mame/handheld/hh_tms1k.cpp`, `src/devices/cpu/tms1000/tms1100.{cpp,h}`,
  `src/devices/cpu/tms1000/tms1k_base.{cpp,h}`, `src/devices/video/pwm.cpp`,
  `src/emu/screen.cpp`. Line numbers are against `mamedev/mame` `master` as fetched on
  2026-07-28 via `raw.githubusercontent.com`; MAME line numbers move, so each quote is
  given in full rather than by reference.
- TI, *TMS 1000 Series Data Manual*, December 1976.
  <https://www.bitsavers.org/components/ti/TMS1000/TMS_1000_Series_Data_Manual_Dec76.pdf>
  (text used here from the Internet Archive OCR of the same scan,
  <https://archive.org/details/bitsavers_tiTMS1000TualDec76_3193454>).
- The teardown photograph in this repository.

---

## 1. The MAME machine that shares our mask

### It is `ginv`, and the board confirms it beyond the mask number

MAME's device list names our mask (`hh_tms1k.cpp` line 131):

```
 @MP2110   TMS1370   1980, Gakken Invader/Tandy Fire Away
```

The `@` is significant. The legend at line 224 reads
`(* means undumped unless noted, @ denotes it's in this driver)`, so MP2110 is both
dumped and driven.

The driver entry (line 6995 onward) opens with a hardware description:

```c
/*******************************************************************************

  Gakken Invader
  * PCB label: GAKKEN, INVADER, KS-00779
  * TMS1370 MP2110 (die label: 1370, MP2110)
  * cyan VFD Itron? CP5008A, 1-bit sound

  known releases:
  - World: Invader, published by Gakken
  - USA(1): Galaxy Invader, published by CGL
  - USA(2): Fire Away, published by Tandy
  - USA(3): Electron Blaster, published by Vanity Fair

  On the real thing, the joystick is "sticky"(it doesn't autocenter when you let go).
  There's also a version with a cyan/red VFD, possibly the same ROM.

*******************************************************************************/
```

and the system entry (line 17832):

```c
SYST( 1980, ginv,       0,         0,      ginv,      ginv,      ginv_state,      empty_init, "Gakken", "Invader (Gakken, cyan version)", MACHINE_SUPPORTS_SAVE )
```

Two independent corroborations from our own photograph, over and above the mask number:

1. **The oscillator components match MAME's note exactly.** MAME's machine config says
   `TMS1370(config, m_maincpu, 350000); // approximation - RC osc. R=47K, C=47pF`. The
   silkscreen immediately below the MP2110 on our board reads **`47K`** and **`47P`**,
   beside a 47 kΩ resistor and a capacitor pad. *(Photo, and Code.)* MAME's comment is
   someone else's reading of the same two components on their own board.
2. **The tube is cyan.** MAME calls this set the "cyan version" and describes a "cyan VFD
   Itron? CP5008A". Our unit's lit reference frames are cyan with an amber/yellow second
   phosphor. *(Photo; the tube part number on our unit is not visible in this shot.)*

The question mark in `Itron? CP5008A` is MAME's own, so the **tube part number is not
settled** even in MAME.

### Class definition

```c
class ginv_state : public hh_tms1k_state
{
public:
	ginv_state(const machine_config &mconfig, device_type type, const char *tag) :
		hh_tms1k_state(mconfig, type, tag)
	{ }

	void ginv(machine_config &config);

private:
	void update_display();
	void write_r(u32 data);
	void write_o(u16 data);
	u8 read_k();
};
```

There is no per-machine state at all. Everything the machine does lives in the three
handlers and in the base class's `m_grid` / `m_plate` / `m_inp_mux`.

### The three handlers - this is the whole I/O map of our machine

```c
void ginv_state::update_display()
{
	m_display->matrix(m_grid, m_plate);
}

void ginv_state::write_r(u32 data)
{
	// R9,R10: input mux
	m_inp_mux = data >> 9 & 3;

	// R15: speaker out
	m_speaker->level_w(data >> 15 & 1);

	// R0-R8: VFD grid
	// R11-R14: VFD plate
	m_grid = data & 0x1ff;
	m_plate = (m_plate & 0xff) | (data >> 3 & 0xf00);
	update_display();
}

void ginv_state::write_o(u16 data)
{
	// O0-O7: VFD plate
	m_plate = (m_plate & ~0xff) | data;
	update_display();
}

u8 ginv_state::read_k()
{
	// K1-K4: multiplexed inputs (K8 is fire button)
	return m_inputs[2]->read() | read_inputs(2);
}
```

Written as a pin budget, every one of the TMS1370's 16 R pins and 8 O pins is spoken for:

| Pins | Count | Role | Source |
| --- | --- | --- | --- |
| R0-R8 | 9 | VFD **grids** (the scan) | Code |
| R11-R14 | 4 | VFD **plates**, the high 4 of 12 | Code |
| R9, R10 | 2 | Input strobe columns | Code |
| R15 | 1 | Speaker, 1-bit | Code |
| O0-O7 | 8 | VFD **plates**, the low 8 of 12 | Code |
| K1, K2, K4 | 3 | Strobed control returns | Code |
| K8 | 1 | Fire button, read directly, not strobed | Code |

**16 R + 8 O, nothing spare.** That the allocation is exactly full is itself evidence the
reading is right: a wrong split would leave pins unexplained or overcommitted.

### Display size and clock

```c
	// basic machine hardware
	TMS1370(config, m_maincpu, 350000); // approximation - RC osc. R=47K, C=47pF
	m_maincpu->read_k().set(FUNC(ginv_state::read_k));
	m_maincpu->write_r().set(FUNC(ginv_state::write_r));
	m_maincpu->write_o().set(FUNC(ginv_state::write_o));

	// video hardware
	screen_device &screen(SCREEN(config, "screen", SCREEN_TYPE_SVG));
	screen.set_refresh_hz(60);
	screen.set_size(236, 1080);
	screen.set_visarea_full();

	PWM_DISPLAY(config, m_display).set_size(9, 12);

	// sound hardware
	SPEAKER(config, "mono").front_center();
	SPEAKER_SOUND(config, m_speaker);
	m_speaker->add_route(ALL_OUTPUTS, "mono", 0.25);
```

**The display matrix is 9 grids by 12 plates.** Not 10 by 20. This contradicts
`src/machine/tube/ATLAS-COORDINATES.md`, which sets `GRID_COUNT = 10` and
`PLATE_COUNT = 20` by borrowing the topology of MAME's `ghalien` (a Hitachi HD38800
machine) because the real chip was thought to be an HD38800. Section 3 below tests 9 x 12
against the photograph and finds it holds.

The `236 x 1080` screen size is the SVG artwork's aspect ratio, not a pixel resolution.
Note the tall-and-narrow shape: MAME renders this tube **rotated to portrait**, where our
unit is played in landscape.

The clock is `350000` with `// approximation` on the same line, and the driver's own file
header warns why (line 19):

```
About the approximated MCU frequency everywhere: The RC osc. is not that
stable on most of these handhelds. When comparing multiple video recordings
of the same game, it shows(and sounds) that the frequency range can differ
up to 50kHz.
```

So **350 kHz is a fitted figure with a stated +/-50 kHz spread, not a measurement of our
unit.** Any cadence we derive from it inherits that spread. This is the specific trap
named in `CLAUDE.md` ("a literal timeout in a test about a machine that stops is a bet on
when it stops") wearing a different hat: a cadence divisor derived from an approximated
clock is a bet on someone else's approximation. Six oscillator cycles make one instruction
cycle (`tms1k_base.cpp`, `m_subcycle = (m_subcycle + 1) % 6`), so 350 kHz is an
instruction rate of 58.3 kHz, or 17.1 us per instruction.

### Input ports

```c
static INPUT_PORTS_START( ginv )
	PORT_START("IN.0") // R9
	PORT_CONFNAME( 0x07, 0x02, DEF_STR( Difficulty ) )
	PORT_CONFSETTING(    0x01, "1" )
	PORT_CONFSETTING(    0x02, "2" )
	PORT_CONFSETTING(    0x04, "3" )
	PORT_BIT( 0x08, IP_ACTIVE_HIGH, IPT_UNUSED )

	PORT_START("IN.1") // R10
	PORT_BIT( 0x01, IP_ACTIVE_HIGH, IPT_JOYSTICK_LEFT )
	PORT_BIT( 0x02, 0x02, IPT_CUSTOM ) PORT_CONDITION("IN.1", 0x05, EQUALS, 0x00) // joystick centered
	PORT_BIT( 0x04, IP_ACTIVE_HIGH, IPT_JOYSTICK_RIGHT )
	PORT_BIT( 0x08, IP_ACTIVE_HIGH, IPT_UNUSED )

	PORT_START("IN.2") // K8
	PORT_BIT( 0x08, IP_ACTIVE_HIGH, IPT_BUTTON1 )
INPUT_PORTS_END
```

Read as hardware, this is a 2-column by 4-row matrix plus one direct line:

- **R9 selects the skill switch.** Three positions, and they are **one-hot on K1/K2/K4**,
  not a binary code. A three-position slide switch closes exactly one of three contacts.
  This is directly relevant to our unit: the skill lever is listed as open question 2d in
  `docs/evidence/open-questions.md`, and this says the program reads it as three separate
  contacts, so an intermediate or bad-contact position reads as *no* skill bit set rather
  than as some other skill.
- **R10 selects the control.** Left on K1, right on K4, **and centre on K2** - a real,
  distinct third contact, asserted by MAME's `IPT_CUSTOM` whenever neither left nor right
  is closed. The comment `// joystick centered` plus the driver header's note that "the
  joystick is 'sticky'(it doesn't autocenter when you let go)" says the program is told
  *centre* explicitly rather than inferring it from the absence of left and right.
- **K8 is the fire button, and it is not strobed.** `read_k()` ORs `m_inputs[2]` in
  unconditionally, so the button reads as pressed on every K sample regardless of what R9
  and R10 are doing.

The K8 detail matters for our architecture rule that "a control movement reaches the game
only by closing a contact on the input matrix". Fire is still a contact, but it is a
contact on an *unstrobed* line, so its latency is one K read rather than one full strobe
cycle.

### How R9/R10 become a K read

The strobing is done in the shared base class rather than in `ginv_state`
(`hh_tms1k.cpp` line 451):

```c
u8 hh_tms1k_state::read_inputs(int columns)
{
	u8 ret = 0;

	// read selected input rows
	for (int i = 0; i < columns; i++)
		if (BIT(m_inp_mux, i))
			ret |= m_inputs[i]->read();

	return ret;
}
```

Plain wired-OR. If the ROM sets both R9 and R10 at once, it gets skill and control
superimposed on the same four K lines and cannot tell them apart, so **the scan loop must
raise exactly one of R9/R10 at a time.** That is a constraint our ROM has to honour, and
it is checkable in a test.

### The sibling machines, for triangulation

`MP2139` (Galaxy Invader 1000, 1981) is the same chip in a later game, and its handlers
are worth having side by side because the *pattern* is the same while every pin has moved:

```c
void ginv1000_state::write_r(u32 data)
{
	// R0: speaker out
	m_speaker->level_w(data & 1);

	// R8,R15: input mux
	m_inp_mux = (data >> 8 & 1) | (data >> 14 & 2);

	// R1-R10: VFD grid
	// R11-R14: VFD plate
	m_grid = data >> 1 & 0x3ff;
	m_plate = (m_plate & 0xff) | (data >> 3 & 0xf00);
	update_display();
}
```

`PWM_DISPLAY(config, m_display).set_size(10, 12);` - ten grids there, nine on ours. The
**constant across both is 12 plates = O0-O7 plus R11-R14**, and the grid count is whatever
the tube needs from what is left. That is the shape of the design: plates are pinned by
the O port's width, grids scale into the spare R pins.

`MP2105` (Gakken Poker, 1979) is the third TMS1370 in the driver and drives a
`set_size(11, 7)` LED-style matrix through a `gpoker.lh` layout rather than an SVG, so it
is not a useful comparison for the tube.

---

## 2. The chip's I/O structure

### Counts

| Property | TMS1370 | Source |
| --- | --- | --- |
| O outputs | 8 | Code: `tms1100.cpp` constructor, `8 /* o pins */` |
| R outputs | 16 | Code: same constructor, `16` |
| K inputs | 4 | Datasheet: "K INPUTS (4 BITS)"; Code: `read_k_input() { return m_read_k() & 0xf; }` |
| Package | 40-pin DIP | Datasheet pinout in `tms1100.h`; Photo confirms 40 pins on our board |
| Relation to TMS1300 | High-voltage version | Code: MAME device comment |

MAME defines it as a TMS1100 with a wider R port:

```c
DEFINE_DEVICE_TYPE(TMS1300, tms1300_cpu_device, "tms1300", "Texas Instruments TMS1300") // 40-pin DIP, 16 R pins
DEFINE_DEVICE_TYPE(TMS1370, tms1370_cpu_device, "tms1370", "Texas Instruments TMS1370") // high voltage version, also seen in 28-pin package(some O/R pins unavailable)

tms1370_cpu_device::tms1370_cpu_device(const machine_config &mconfig, const char *tag, device_t *owner, u32 clock) :
	tms1100_cpu_device(mconfig, TMS1370, tag, owner, clock, 8, 16, 6, 8, 3, 1, 11, address_map_constructor(FUNC(tms1370_cpu_device::rom_11bit), this), 7, address_map_constructor(FUNC(tms1370_cpu_device::ram_7bit), this))
{ }
```

and carries the pinout as a comment in `tms1100.h`, shared with the TMS1300:

```
            ____   ____
    R11  1 |*   \_/    | 40 R10
    R12  2 |           | 39 R9
    R13  3 |           | 38 R8
    R14  4 |           | 37 R7
    R15  5 |           | 36 R6
    Vdd  6 |           | 35 NC
     K1  7 |           | 34 R5
     K2  8 |           | 33 R4
     K4  9 |           | 32 R3
     K8 10 |  TMS1300  | 31 R2
   INIT 11 |  TMS1370  | 30 R1
     O7 12 |           | 29 R0
     NC 13 |           | 28 Vss
     NC 14 |           | 27 OSC2
     NC 15 |           | 26 OSC1
     O6 16 |           | 25 O0
     O5 17 |           | 24 O1
     O4 18 |           | 23 O2
     O3 19 |           | 22 NC
     NC 20 |___________| 21 NC
```

That is 16 R + 8 O + 4 K + Vdd + Vss + OSC1 + OSC2 + INIT = 33 signal pins in a 40-pin
package, with 7 marked NC. **There is no spare port to add plates to.**

### The O output PLA

This is the part with no equivalent in the HMCS40 world, and it changes how a program
writes to the display. TI's own description (Data Manual Dec 1976, section 2.6 Output):

> There are two output channels with multiple purposes, the R outputs and the O outputs.
> Thirteen latches store the R output data. The eight parallel O outputs come from a
> five-bit-to-eight-bit code converter, which is the O-output PLA.

> The eight O outputs usually send out display or binary data that are encoded from the O
> output latches. The O latches contain five bits. Four bits load from the accumulator in
> parallel. The fifth bit comes from the status latch, which is selectively loaded from
> the adder output (see Figure 4). The load output command sends the status latch and
> accumulator information into the five output latches. The five bits are available in
> true or complementary form to 20 programmable-input NAND gates in the 0 output PLA.
> Each NAND gate can simultaneously select any combination of O0 through 07 as an output.
> The user defines this PLA's decoding to suit an optimum output configuration.

> As an illustration, the O output PLA can encode any 16 characters of eight-segment
> display information and additionally can transfer out a four-bit word of binary data.

MAME implements exactly that as a 32-entry lookup, indexed by `status_latch:accumulator`:

```c
void tms1k_base_device::write_o_reg(u8 index)
{
	// a hardcoded table is supported if the output pla is unknown
	m_o_index = index;
	m_o = (m_output_pla_table == nullptr) ? m_opla->read(index) : m_output_pla_table[index];
	write_o_output(m_o);
}

void tms1k_base_device::op_tdo()
{
	// TDO: transfer accumulator and status latch to O-register
	write_o_reg(m_status_latch << 4 | m_a);
}

void tms1k_base_device::op_clo()
{
	// CLO: clear O-register
	write_o_reg(0);
}
```

**Consequences for us, and they are large:**

1. **The program cannot write an arbitrary 8-bit pattern to the O pins.** It writes a
   4-bit accumulator plus a 1-bit status latch, and the *mask* decides what 8-bit pattern
   comes out. Only 32 distinct O patterns exist for a given chip, ever.
2. **That means the plate patterns are partly in the PLA, not in the ROM.** Our low 8
   plates - and therefore, if the mapping is anything like our atlas, most of a playfield
   column - are addressed through a table that is part of the silicon, and only 32 rows
   wide. If a rebuild wants to say "these three lanes are lit", the pattern must be one of
   32 the PLA can produce.
3. **The PLA is a design surface we get to author.** We are writing our own program for
   this chip, so we author our own O PLA the way Gakken did. It is not an emulator
   parameter to be discovered; it is 32 entries we choose, and choosing them well is what
   makes a scan loop cheap.
4. **It is a real constraint on faithfulness.** If we later compare against the dumped
   MP2110 (section 5), our PLA and Gakken's will differ, so O-pin traces will not match
   even when behaviour does. Comparison has to be at the *lit segment* level, not the pin
   level.

MAME has the original for our machine: the romset carries
`tms1100_ginv_output.pla`, 365 bytes, `CRC(6e33a24e)`.

### The R outputs

TI again (section 2.6):

> The R outputs are individually addressed by the Y register. Each addressed bit can be
> set or reset. The R outputs are normally used to multiplex inputs and strobe 0 output
> data to displays, external memories, and other devices.

One line at a time, addressed by Y, which is why a scan loop is a Y-indexed walk rather
than a port write:

```c
void tms1k_base_device::op_setr()
{
	// SETR: set one R-output line
	m_r = m_r | (1 << m_y);
	write_r_output(m_r);
}

void tms1k_base_device::op_rstr()
{
	// RSTR: reset one R-output line
	m_r = m_r & ~(1 << m_y);
	write_r_output(m_r);
}
```

With 16 R lines, four bits of Y are not enough, so the TMS1100 family borrows the top bit
of X:

```c
void tms1100_cpu_device::op_setr()
{
	// SETR: supports 5-bit index with X MSB (used when it has more than 16 R pins)
	// TMS1100 manual simply says that X must be less than 4
	u8 index = BIT(m_x, m_x_bits - 1) << 4 | m_y;
	m_r = m_r | (1 << index);
	write_r_output(m_r);
}
```

The datasheet's version of the same rule, for the TMS1100/1300 (section 3.3):

> When using the set or reset R instructions, the X register must be less than four.

**So `SETR` and `RSTR` read the X register.** Any routine that strobes an R line has a
hidden dependency on which RAM file is currently selected. That is a bug source with no
analogue in what this project has written before, and it deserves an assembler-level check
rather than discipline.

The datasheet also confirms the TMS1300's R port is the one the TMS1370 inherits
(section 3.4):

> The TMS 1100 is pin-for-pin interchangeable with the TMS 1000 and contains eleven R
> outputs and eight O outputs. The R-output capability in the TMS 1300 is increased to 16
> output latches.

### The K inputs

Four lines, named by bit weight (K1, K2, K4, K8), read as a nibble onto the CKI bus by the
`0000 1xxx` instruction group:

```c
void tms1k_base_device::set_cki_bus()
{
	switch (m_opcode & 0xf8)
	{
		// 00001XXX: K-inputs
		case 0x08:
			m_cki_bus = read_k_input();
			break;
```

sampled at subcycle 0 of the instruction (`// execute: k input valid, read ram, ...`), so
**a K read sees the state of the pins at that instant**; there is no input latch and no
edge detector anywhere on the input side. Contact debouncing, edge detection and
auto-repeat are all the ROM's problem, and a contact closed and released between two K
reads is simply never seen.

The output side is the mirror image and matters for audio: the speaker hangs off `R15`,
one of the same 16 latches the grids come from, so a sound edge is a `SETR`/`RSTR` on a
latch and is timed by when the ROM executes it. Our `src/machine/board/speaker.ts` models
the speaker as edge capture on `D14`; the **cycle-stamped-edge model carries across
unchanged, the pin and the write mechanism do not**. Nothing about R15 changes the
argument in open-questions section 7 that a continuous 4 s buzz has to be clocked off the
display sweep on a single-core machine - if anything it sharpens it, because the buzz pin
and the grid pins are latches in the same register.

### Timing envelope

From the Data Manual's recommended operating conditions for the TMS1000/1200 and
TMS1100/1300:

| Parameter | Min | Nom | Max |
| --- | --- | --- | --- |
| Oscillator frequency, f_osc | 100 kHz | | 400 kHz |
| Instruction cycle time, t_c | 15 us | | 60 us |
| Supply voltage, Vdd | -14 V | -15 V | -17.5 V |

MAME's 350 kHz for `ginv` sits inside that, at 17.1 us per instruction. Note the supply is
**negative**: this family runs Vss at 0 and Vdd negative, which is why the board's
silkscreen `11V` and the tube bias make sense together, and why a "high" output is the
*less negative* level.

---

## 3. Can a TMS1370 drive our tube directly? Yes, and the board says it does

### The chip is the only IC on the board

*(Photo.)* `board-L1001567.jpg` shows the complete component side of the PCB. Counting
integrated circuits: **one**. The 40-pin DIP at the right of the board, reading
`MP2110` / `MSHL(triangle)8040` beside the Texas Instruments logo. There is no second DIP,
no transistor array, no VFD driver package anywhere on the board.

Everything else on the board is passive or discrete:

- A row of **~21 axial resistors** in a single line between the MCU end of the board and
  the tube's lead strip. Counted from the photograph in two overlapping crops, both giving
  21; call it **21 +/- 1**, because six of them at the left of the row are in the shadow of
  the power lead.
- Two TO-92 transistors, silkscreened **`1815`** and **`2120`** (so almost certainly a
  2SC1815 and a 2SC2120), next to the round piezo sounder. That is the 1-bit audio output
  stage: `R15` into a two-transistor driver into the sounder. *(Photo; the transistor part
  numbers are read from silkscreen, not from the devices.)*
- Electrolytics (47 uF, 10 uF, 1 uF), a few discrete resistors with printed values
  (`47K`, `2.2K`, `470`, `47P`), two diodes, six wire links, and the silkscreen note
  **`11V`**.
- `JET FIGHTER` in silkscreen on the board itself.

**So the pin budget has to work, because there is nothing else to do the work.** And it
does: section 1's table accounts for all 24 output pins with 9 grids and 12 plates.

### Why this chip and not the TMS1300

Because the TMS1370 is the high-voltage part, and TI sold that difference specifically for
this job. From the Data Manual, section 5.1, describing the equivalent pairing one
generation earlier (TMS1070/1270 are the high-voltage TMS1000/1200):

> The TMS 1000 series flexibility is augmented by two versions of high-voltage (35-volt)
> microcomputers, the TMS 1070 and the TMS 1270. The standard instruction set and
> operation is identical to that of the TMS 1000/1200. [...] **The TMS 1070/1270 provides
> direct interface to low-voltage flourescent displays.** The TMS 1070/1270 interfaces
> with all circuits requiring up to 35-volt levels. The accompanying diagram, Figure 9,
> shows an interface to a 30-volt fluorescent display.

and Figure 9 itself, which is the architecture of our board in one line:

> (SEGMENT DATA) (DIGIT STROBE) O R OUTPUTS 0-30V
> FIGURE 9 - STROBED FLUORESCENT DISPLAY INTERCONNECT

O outputs carry segment data, R outputs carry the digit strobe, both swinging to 30 V, no
driver in between. The TMS1370 is the same relationship applied to the TMS1300
(MAME: `// high voltage version`), which is why an eleven-volt VFD hangs off it with
nothing but series resistors. *(The 35 V figure is quoted for the TMS1070/1270; the
TMS1370's own maximum rating is **Unknown** to this document, as no TMS1370 datasheet was
located. The board runs 11 V, well inside either.)*

### The tube itself: 9 grids and 12 plates is consistent with the photograph

Our atlas asserts 10 grids and up to 20 plates. That number came from `ghalien`, a
different chip in a different machine, chosen when we believed our chip was an HD38800. It
is now an orphan. What the photograph shows, with the tube unpowered so **every** phosphor
segment is visible at once:

*(Photo, counted from `board-L1001567.jpg`.)*

| Region, left to right | What is printed there |
| --- | --- |
| Score block, upper | The word `SCORE`, one solid label, spanning the full width of the block |
| Score block, lower | A hundreds place that can only ever read `1` (two vertical segments, no others), then **two** full seven-segment digits. An L-shaped outline wraps the label and the first digit; the second digit has its own box. |
| Playfield cell 1 | Three lanes, each carrying a **battleship** (amber, on water) and a white burst. No jet. |
| Playfield cells 2-6 | Three lanes, each carrying an amber **jet** and a white burst |
| Playfield cell 7 | Three lanes, each carrying an amber shape that reads as **smoke or a launcher**, an amber burst, and a white shape. No jet. |

**Seven playfield cells, not six**, and the contents settle which of two rival readings is
right. `ATLAS-COORDINATES.md` sets out the conflict at length: the atlas is built on
"crop `colN` = atlas grid `N - 1`", six playfield grids, while the sprite catalogue says
the printed reading is seven cells, "battleship alone in cell 0, jets in cells 1-5, the
launcher alone in cell 6", and that "the two readings cannot both be right, and the atlas
cannot express the second one at all". The unpowered tube shows exactly the catalogue's
arrangement: **no jet in the battleship's cell, no jet in the launcher's cell, seven cells
in all.** Assumption 3 in the same document ("six distance columns [...] the real column
count may be higher") resolves to seven.

Seven playfield cells plus a two-grid score block is **nine grids**, which is exactly what
MAME's `set_size(9, 12)` says. Twelve plates covers every cell with room to spare: cells
1-6 carry two shapes per lane, so six plates; cell 7 carries three, so nine. The score
digits need seven segments each. Nothing on the tube needs more than twelve plates under
one grid, which is why twelve was enough for Gakken and why the atlas's twenty is not a
hardware figure.

`ATLAS-COORDINATES.md` anticipates the split as "7 playfield, 2 score digit cells, 1 label
against the atlas's 6, 3, 1" - which totals **ten**, one more than MAME allows. The
reconciliation the photograph supports is that **the `SCORE` label is a plate on one of the
two score grids rather than a grid of its own**: it is a single solid block sitting
directly above the digits, inside the same outline, so a mesh covering the label and a
digit together is the natural construction. That is an **inference**, not a reading; it
follows from 9 minus 7 leaving 2, and it is the cheapest way to make the printed reading
and MAME's matrix size agree.

The hundreds place is worth noting on its own: it carries **only the two segments needed
for a `1`**, so the display cannot show a hundreds digit other than 1 or blank. That is
direct physical confirmation of the **score cap of 199** recorded in open-questions
section 7, which had until now been inferred from gameplay video.

And the resistor count lands on the same number: **21 electrodes = 9 grids + 12 plates**,
against 21 +/- 1 resistors counted. One series resistor per driven electrode is the
standard arrangement for this interface.

That is three independent things agreeing - MAME's matrix size, the printed regions on the
glass, and the resistor count - so **9 x 12 should be treated as the working topology and
10 x 20 as superseded.**

**One thing does not line up, and it is flagged rather than explained away.** The tube's
lead-frame strip has visibly more positions than 21: counting tabs along the white strip
gives roughly 31 (+/- 2), at about half the pitch of the resistor row, with at least one
blank position. Some of those must be filament connections, some are unused lead-frame
positions, and some may be commoned on the PCB. **A lead count is therefore not an
electrode count**, and nothing here should be built on 31. Settling it needs a continuity
check on the board, not a better photograph.

---

## 4. How MAME renders these VFDs

The path is short, and it is the same idea as our `atlas.json` plus renderer.

**Step 1 - the chip's outputs become a matrix.** `ginv_state::update_display()` calls
`m_display->matrix(m_grid, m_plate)`. `pwm_display_device` exists to stop a strobed
display flickering, and it explains itself (`src/devices/video/pwm.cpp`):

```
This thing is a generic helper for PWM(strobed) display elements, to prevent
flickering and optionally handle perceived brightness levels.

Common usecase is to call matrix(selmask, datamask), a collision between the
2 masks implies a powered-on display element (eg. a LED, or VFD sprite).

Display element states are sent to output tags "y.x" where y is the matrix row
number, x is the row bit. It is also sent to "y.a" for all rows. The output state
is 0 for off, and >0 for on, depending on brightness level.

Brightness tresholds (0.0 to 1.0) indicate how long an element was powered on
in the last frame, eg. 0.01 means a minimum on-time for 1%. Some games use two
levels of brightness by strobing elements longer.
```

with the naming in code:

```c
		if (!m_out_x)
			m_out_x.emplace(*this, "%u.%u", 0U, 0U);
```

So every lit segment becomes a MAME output named **`"<grid>.<plate>"`** - `"0.0"`,
`"8.11"`. That is `(grid, plate)` addressing, identical in shape to ours.

**Step 2 - the SVG binds segments to those names by `<title>`.** `ginv` has no internal
layout file at all: `src/mame/layout/ginv.lay` does not exist in the MAME tree, and the
driver never calls `config.set_default_layout(...)` for it. (Contrast `gpoker`, the other
TMS1370 in the driver, which does have `src/mame/layout/gpoker.lay` and does call
`set_default_layout(layout_gpoker)` - that is the LED-matrix path, not the tube path.)
`ginv` uses an SVG screen instead:

```c
	screen_device &screen(SCREEN(config, "screen", SCREEN_TYPE_SVG));
```

and `src/emu/screen.cpp` keys the SVG's shapes on their `<title>` text:

```c
	for (NSVGshape *shape = m_image->shapes; shape; shape = shape->next)
		if(shape->title[0]) {
			const auto it = m_key_ids.find(shape->title);
			if(it != m_key_ids.end())
				m_keyed_shapes[it->second].push_back(shape);
			else {
				const int id = m_key_count++;
				m_keyed_shapes.resize(m_key_count);
				m_keyed_shapes[id].push_back(shape);
				m_key_ids[shape->title] = id;
			}
		}
```

then matches output changes against those same keys:

```c
void screen_device::svg_renderer::output_change(const osd::output_item &output)
{
	// for now, use the unqualified name for backwards compatibility
	// TODO: migrate to using qualified output names
	const auto l = m_key_ids.find(output.name());
	if (l == m_key_ids.end())
		return;
	m_key_state[l->second] = output.value();
}
```

and toggles `NSVG_FLAGS_VISIBLE` per shape before rasterising.

**So `ginv.svg` is a file in which each phosphor segment is a path whose `<title>` is
literally `"grid.plate"`.** Several paths may share a title, which is how one logical
segment can be drawn as several shapes.

The comparison to our own stack, which is worth stating plainly because the architectures
converged independently:

| MAME | This project |
| --- | --- |
| SVG path with `<title>` = `"<grid>.<plate>"` | `atlas.json` entry with a `(grid, plate)` address and an outline |
| `pwm_display_device` brightness thresholds | `src/machine/tube/` phosphor rise/decay curves |
| `NSVG_FLAGS_VISIBLE` per shape, binary | Per-segment continuous brightness |

Ours is the more capable of the two on the phosphor side - `pwm.cpp`'s own TODO admits
"SVG screens and rendlay digit elements don't support multiple brightness levels". Theirs
is the more trustworthy on geometry, because someone traced a real `ginv` tube.

**We do not have `ginv.svg`, and that is the single most valuable artifact still outside
this repository.** It is not in the MAME source tree; it ships inside the romset, declared
as:

```c
	ROM_REGION( 142959, "screen", 0)
	ROM_LOAD( "ginv.svg", 0, 142959, CRC(36a04f56) SHA1(a81c80e51d0a9d2855bf026236a257cf771be35c) )
```

143 KB of hand-traced outlines for a tube that is either ours or its near twin, already
addressed as `(grid, plate)`, with every segment named. If the owner obtains the set, that
file answers assumption 1 of `ATLAS-COORDINATES.md` ("No photo shows which grid drives
which segment") directly, and is comparable against our atlas without running MAME at all.

Caveat worth keeping: `ginv` is the "cyan version", and MAME's own header says "There's
also a version with a cyan/red VFD, possibly the same ROM". Our unit has a second amber
phosphor. So `ginv.svg` may be a **different tube running the same program**, and its
geometry is evidence about ours rather than a photograph of ours.

---

## 5. What the ROM dump means for us

What exists, stated without reproducing any content:

```c
ROM_START( ginv )
	ROM_REGION( 0x0800, "maincpu", 0 )
	ROM_LOAD( "mp2110", 0x0000, 0x0800, CRC(f09c5588) SHA1(06eb8ed512eaf5367ea30c2b633219e105ddfd14) )

	ROM_REGION( 867, "maincpu:mpla", 0 )
	ROM_LOAD( "tms1100_common2_micro.pla", 0, 867, CRC(7cc90264) SHA1(c6e1cf1ffb178061da9e31858514f7cd94e86990) )
	ROM_REGION( 365, "maincpu:opla", 0 )
	ROM_LOAD( "tms1100_ginv_output.pla", 0, 365, CRC(6e33a24e) SHA1(cdf7ecf12ddd3863e6301e20fe80f9737db429e5) )

	ROM_REGION( 142959, "screen", 0)
	ROM_LOAD( "ginv.svg", 0, 142959, CRC(36a04f56) SHA1(a81c80e51d0a9d2855bf026236a257cf771be35c) )
ROM_END
```

| File | Size | What it is |
| --- | --- | --- |
| `mp2110` | 2048 bytes | The game program. 2048 words of 8 bits, the TMS1100/1370 ROM in full. |
| `tms1100_common2_micro.pla` | 867 bytes | The **microinstruction** PLA. Shared across many TMS1100 machines, so not specific to our game. |
| `tms1100_ginv_output.pla` | 365 bytes | The **O output** PLA. Custom to this mask. This is the 32-entry table of section 2. |
| `ginv.svg` | 142959 bytes | The tube artwork, `(grid, plate)`-addressed. See section 4. |

Note what the third row means: **the display encoding is a separate dumped artifact from
the program.** Anyone reading `mp2110` without the opla can see *which* index the ROM
loads, but not what pattern reaches the pins. Both are needed to say what lights up. MAME
also warns in its own TODO (line 47) that these are not all verified:

```
- Verify output PLA and microinstructions PLA for MCUs that have been dumped
  electronically (mpla is usually the default, opla is often custom).
```

### How this document recommends the dump be used

The owner's decision, recorded in open-questions section 7, is that **we write our own
program for the correct chip and compare against the original only once ours works.** So
the dump is a **test oracle**, not an import. Concretely, that means:

- **Do not** disassemble `mp2110` and transliterate it into `asm/jetfighter.asm`. That
  would make the project a port of someone else's dump and would end the reconstruction.
- **Do** treat the disagreement between our program and the original as a *bug report
  against ours*, once ours runs. The comparison surface has to be **the lit segment set
  over time**, not pin traces, because our O PLA will differ from Gakken's by
  construction (section 2). Two programs with different PLAs can light the same tube
  identically and share not one O-pin value.
- **Do** treat `ginv.svg` and `tms1100_ginv_output.pla` as separable from `mp2110`. The
  artwork is geometry evidence and the opla is an encoding, and using either does not
  commit us to running the original program.
- The natural home for this is `tools/probe/` alongside the existing headless machine
  probe, once a TMS1370 core exists.

**Nothing in this section requires obtaining the ROM to proceed.** Everything in sections
1 through 4 - the pin map, the matrix size, the input matrix, the display architecture -
was read out of MAME's driver source and TI's datasheet, both public, and corroborated
against a photograph we already own.

---

## What this changes in the repository

No code was changed by this task. These are the consequences it hands on, each with the
section that argues it.

| Currently in the repo | What this research says | Section |
| --- | --- | --- |
| `GRID_COUNT = 10` and `PLATE_COUNT = 20` (`src/machine/tube/atlas-schema.ts`, `src/machine/board/display.ts`) | 9 and 12. The 10/20 figures were borrowed from `ghalien`, an HD38800 machine, and have no remaining basis. | 1, 3 |
| Six playfield columns (`ATLAS-COORDINATES.md` assumption 3) | Seven, with no jet in the first cell or the last. The catalogue's printed reading was right and the atlas's was not. | 3 |
| Grids on D0-D9, the twenty-line plate bus on the R ports (`display.ts`) | Grids are **R0-R8**; plates are **O0-O7 plus R11-R14**. There is no D port on this chip at all. | 1, 2 |
| Speaker on D14, with edge capture in `src/machine/board/speaker.ts` | Speaker is **R15**, one of the same 16 R latches the grids come from, set and reset by `SETR`/`RSTR`. The cycle-stamped edge model carries; the pin and the write mechanism do not. | 1, 2 |
| Inputs read through a strobe matrix on a dedicated input port | K1/K2/K4 strobed from R9/R10 by wired-OR, plus **K8 unstrobed** for fire. Only one of R9/R10 may be high at a time or the two columns superimpose. | 1 |
| A display sweep free to write any plate pattern per grid | The low 8 plates come through a 32-entry O PLA indexed by status latch and accumulator. The pattern set is finite, and it is ours to design rather than to discover. | 2 |
| Score modelled as three full digits | Two full digits plus a `1`-only hundreds place, which is why the cap is 199. | 3 |

## What this does not settle

| Gap | Why it is open | What would settle it |
| --- | --- | --- |
| **The exact grid and plate address of every segment.** | Section 3 establishes the *shape* (9 x 12) and the *regions*, not the assignment. Which R line drives cell 1 versus cell 7, and which plate is a jet versus a burst, is unknown. | `ginv.svg` from the romset, read directly. Failing that, continuity tracing from each of the 21 resistors to a tube lead, then to a phosphor region. |
| **Whether our tube is `ginv`'s tube.** | MAME's is the "cyan version"; ours has a second amber phosphor and MAME's header allows for a cyan/red variant on the same ROM. Segment geometry could differ while the program does not. | The tube's own part number, visible on the glass or the lead strip with the tube removed. MAME's own guess, `Itron? CP5008A`, carries a question mark. |
| **The real clock frequency.** | 350 kHz is MAME's fitted approximation with a stated +/-50 kHz spread across specimens, not a measurement. Every cadence derived from it inherits that. | Measuring OSC1/OSC2 on the owner's unit, or deriving it from a measured display refresh rate against a known sweep length. Until then, cadence work must land inside measured audio bands rather than on a computed figure. |
| **The TMS1370's own maximum output voltage.** | The 35 V figure is quoted for the TMS1070/1270 from the 1976 manual. No TMS1370 datasheet was located; bitsavers' TMS1000 directory does not appear to carry one, and wikichip was unreachable during this work. | A TMS1300/1370 datasheet or the 1979-1982 TI data book. Not load-bearing: the board runs 11 V. |
| **The tube's lead count versus its electrode count.** | ~31 lead positions against 21 resistors. Filament, unused positions and PCB commoning are all plausible and none is confirmed. | Continuity check from lead tabs to resistors on the physical board. |
| **The transistor part numbers.** | Read from silkscreen (`1815`, `2120`), not from the devices, which are mounted face-down in this shot. | A photograph of the two TO-92 bodies, or lifting one. |
| **Which O PLA entries the original uses for what.** | We have the opla's existence, size and hash, not its contents. | Extracting `tms1100_ginv_output.pla` from the romset. Not needed to write our own. |
| **Whether the score's hundreds place is a separate plate or a separate grid.** | The photograph shows a `1`-only hundreds place sharing an enclosure with the first full digit. Whether it is addressed on the same grid as that digit or its own is not visible. | The same continuity trace, or `ginv.svg`. |
| **The skill switch's contact behaviour on our unit.** | MAME says one-hot on K1/K2/K4 for `ginv`. Our unit's lever is open question 2d and has not been photographed at two settings. | The photographs requested in open-questions 2d, plus continuity across the lever positions. |
