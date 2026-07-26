// Loader, validator, and lookup indexes for the VFD segment atlas.
//
// Pure data access only: this module never draws and never touches the DOM, so
// it imports cleanly in plain Node (headless machine probe, Vitest). atlas.json
// is imported statically - there is no fetch() path and no async loading.
//
// See ATLAS-COORDINATES.md for the coordinate system, photo provenance, and the
// documented assumptions behind the grid/plate mapping.

import rawAtlas from './atlas.json';
import type {
  Atlas,
  ColorRegion,
  Segment,
  SegmentId,
  ValidationResult,
} from './atlas-schema.js';
import {
  EXPECTED_SEGMENT_COUNTS,
  GRID_COUNT,
  PLATE_COUNT,
  TOTAL_SEGMENT_COUNT,
} from './atlas-schema.js';

const COLOR_REGIONS: readonly string[] = ['cyan', 'red'];

/** Recognised id patterns, with the count each family must contribute. */
const ID_FAMILIES: readonly {
  readonly name: keyof typeof EXPECTED_SEGMENT_COUNTS;
  readonly pattern: RegExp;
}[] = [
  { name: 'jet', pattern: /^jet_lane[0-2]_col[0-5]$/ },
  { name: 'rocket', pattern: /^rocket_lane[0-2]_col[0-5]$/ },
  { name: 'missile', pattern: /^missile_lane[0-2]_dot[01]$/ },
  { name: 'launcher', pattern: /^launcher_lane[0-2]$/ },
  { name: 'score', pattern: /^score_digit[0-2]_seg[a-g]$/ },
  { name: 'explosion', pattern: /^explosion_lane[0-2]$/ },
  { name: 'battleship', pattern: /^battleship$/ },
  { name: 'scoreLabel', pattern: /^score_label$/ },
];

/** The (grid, plate) index key. Exported so consumers can build their own maps. */
export function addressKey(grid: number, plate: number): string {
  return `${grid}-${plate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, min: number, maxExclusive: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value < maxExclusive;
}

function validateViewBox(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('atlas.viewBox: expected an object with x, y, width and height');
    return;
  }
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    errors.push('atlas.viewBox: x and y must be finite numbers');
  }
  if (!isFiniteNumber(value.width) || value.width <= 0) {
    errors.push('atlas.viewBox: width must be a positive number');
  }
  if (!isFiniteNumber(value.height) || value.height <= 0) {
    errors.push('atlas.viewBox: height must be a positive number');
  }
}

function validateBounds(bounds: unknown, where: string, errors: string[]): void {
  if (!isRecord(bounds)) {
    errors.push(`${where}: bounds must be an object with x, y, width and height`);
    return;
  }
  if (!isFiniteNumber(bounds.x) || !isFiniteNumber(bounds.y)) {
    errors.push(`${where}: bounds.x and bounds.y must be finite numbers`);
  }
  if (!isFiniteNumber(bounds.width) || bounds.width <= 0) {
    errors.push(`${where}: bounds.width must be a positive number`);
  }
  if (!isFiniteNumber(bounds.height) || bounds.height <= 0) {
    errors.push(`${where}: bounds.height must be a positive number`);
  }
}

function validateSegment(
  raw: unknown,
  index: number,
  seenIds: Map<string, number>,
  seenAddresses: Map<string, string>,
  familyCounts: Map<string, number>,
  errors: string[],
): void {
  const where = `atlas.segments[${index}]`;
  if (!isRecord(raw)) {
    errors.push(`${where}: expected an object`);
    return;
  }

  const id = raw.id;
  if (typeof id !== 'string' || id.length === 0) {
    errors.push(`${where}: id must be a non-empty string`);
  } else {
    const previous = seenIds.get(id);
    if (previous !== undefined) {
      errors.push(`${where}: duplicate segment id '${id}', already used by atlas.segments[${previous}]`);
    } else {
      seenIds.set(id, index);
    }
    const family = ID_FAMILIES.find((f) => f.pattern.test(id));
    if (!family) {
      errors.push(`${where}: unknown segment id '${id}' - it matches no documented segment family`);
    } else {
      familyCounts.set(family.name, (familyCounts.get(family.name) ?? 0) + 1);
    }
  }

  const label = `${where} ('${typeof id === 'string' ? id : '?'}')`;

  if (!isIntegerInRange(raw.grid, 0, GRID_COUNT)) {
    errors.push(`${label}: grid must be an integer in 0..${GRID_COUNT - 1}, got ${String(raw.grid)}`);
  }
  if (!isIntegerInRange(raw.plate, 0, PLATE_COUNT)) {
    errors.push(`${label}: plate must be an integer in 0..${PLATE_COUNT - 1}, got ${String(raw.plate)}`);
  }
  if (typeof raw.path !== 'string' || raw.path.trim().length === 0) {
    errors.push(`${label}: path must be a non-empty SVG path string`);
  }
  if (typeof raw.colorRegion !== 'string' || !COLOR_REGIONS.includes(raw.colorRegion)) {
    errors.push(
      `${label}: colorRegion must be one of ${COLOR_REGIONS.join(' | ')}, got ${String(raw.colorRegion)}`,
    );
  }
  validateBounds(raw.bounds, label, errors);

  if (isIntegerInRange(raw.grid, 0, GRID_COUNT) && isIntegerInRange(raw.plate, 0, PLATE_COUNT)) {
    const key = addressKey(raw.grid as number, raw.plate as number);
    const owner = seenAddresses.get(key);
    if (owner !== undefined) {
      errors.push(`${label}: duplicate address ${key}, already driven by '${owner}'`);
    } else {
      seenAddresses.set(key, typeof id === 'string' ? id : where);
    }
  }
}

/**
 * Validate arbitrary data against the atlas schema. Never throws: collects every
 * problem so a broken atlas can be fixed in one pass. `valid` is true exactly
 * when `errors` is empty.
 */
export function validateAtlas(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { valid: false, errors: [`atlas: expected an object, got ${data === null ? 'null' : typeof data}`] };
  }

  validateViewBox(data.viewBox, errors);

  const segments = data.segments;
  if (!Array.isArray(segments)) {
    errors.push('atlas.segments: expected an array of segments');
    return { valid: false, errors };
  }

  if (segments.length !== TOTAL_SEGMENT_COUNT) {
    errors.push(
      `atlas.segments: expected ${TOTAL_SEGMENT_COUNT} segments (the full tube), got ${segments.length}`,
    );
  }

  const seenIds = new Map<string, number>();
  const seenAddresses = new Map<string, string>();
  const familyCounts = new Map<string, number>();
  segments.forEach((segment, index) => {
    validateSegment(segment, index, seenIds, seenAddresses, familyCounts, errors);
  });

  for (const family of ID_FAMILIES) {
    const expected = EXPECTED_SEGMENT_COUNTS[family.name];
    const actual = familyCounts.get(family.name) ?? 0;
    if (actual !== expected) {
      errors.push(`atlas.segments: expected ${expected} '${family.name}' segments, got ${actual}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

let cached: Atlas | null = null;
let byId: Map<string, Segment> | null = null;
let byAddress: Map<string, Segment> | null = null;

/**
 * Load, validate, and cache the segment atlas. Throws a descriptive Error
 * listing every schema violation if `atlas.json` is invalid - a malformed atlas
 * is a build-time defect, not a runtime condition to degrade around.
 */
export function loadAtlas(): Atlas {
  if (cached) return cached;

  const result = validateAtlas(rawAtlas);
  if (!result.valid) {
    throw new Error(
      `Invalid VFD segment atlas (src/machine/tube/atlas.json):\n  - ${result.errors.join('\n  - ')}`,
    );
  }

  const atlas = rawAtlas as unknown as Atlas;
  const ids = new Map<string, Segment>();
  const addresses = new Map<string, Segment>();
  for (const segment of atlas.segments) {
    ids.set(segment.id, segment);
    addresses.set(addressKey(segment.grid, segment.plate), segment);
  }

  cached = atlas;
  byId = ids;
  byAddress = addresses;
  return atlas;
}

function idIndex(): Map<string, Segment> {
  loadAtlas();
  return byId as Map<string, Segment>;
}

function addressIndex(): Map<string, Segment> {
  loadAtlas();
  return byAddress as Map<string, Segment>;
}

/**
 * The segment driven at (grid, plate), or undefined when that address is not
 * wired to a segment. O(1). Most of the 10 x 20 address space is unwired.
 */
export function getSegmentByAddress(grid: number, plate: number): Segment | undefined {
  return addressIndex().get(addressKey(grid, plate));
}

/**
 * The segment with the given semantic id. O(1). Throws if the id is absent -
 * {@link SegmentId} is exhaustive, so a miss means atlas.json has drifted from
 * the schema and the caller cannot sensibly continue.
 */
export function getSegmentById(id: SegmentId): Segment {
  const segment = idIndex().get(id);
  if (!segment) {
    throw new Error(`Unknown segment id '${id}' - not present in src/machine/tube/atlas.json`);
  }
  return segment;
}

/** Every segment on one display grid, in atlas order. Used by the scan loop. */
export function getSegmentsByGrid(grid: number): readonly Segment[] {
  return loadAtlas().segments.filter((segment) => segment.grid === grid);
}

/** Every segment in one phosphor region, for the two-colour render passes. */
export function getSegmentsByColor(color: ColorRegion): readonly Segment[] {
  return loadAtlas().segments.filter((segment) => segment.colorRegion === color);
}

/** Every segment id in atlas order - a debugging aid for probes and tests. */
export function listAllIds(): readonly SegmentId[] {
  return loadAtlas().segments.map((segment) => segment.id);
}
