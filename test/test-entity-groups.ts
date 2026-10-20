/**
 * Tests for grouping detections by value and the starting selection on the Choose screen
 */
import { allSelected, applyDefaultSelection, groupByValue } from '../src/utils/entity-groups';
import { EntityType, type DetectedEntity } from '../src/lib/types';

let passed = 0;
let failed = 0;

function check(description: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`✓ ${description}`);
  } else {
    failed++;
    console.log(`✗ ${description}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

let nextId = 0;
const entity = (text: string, entityType: EntityType, status: DetectedEntity['status'] = 'rejected'): DetectedEntity => ({
  id: String(nextId++),
  text,
  entityType,
  confidence: 0.9,
  position: { pageNumber: 1, textIndex: 0, boundingBox: { x: 0, y: 0, width: 0, height: 0 } },
  detectionMethod: 'regex',
  status,
  contextText: `about ${text}`,
});

console.log('\n=== groupByValue ===');
{
  const groups = groupByValue([
    entity('Zhang San', EntityType.PERSON),
    entity('zhang  san ', EntityType.PERSON, 'confirmed'),
    entity('Zhang San', EntityType.ORGANIZATION),
    entity('Li Si', EntityType.PERSON),
    entity('Zhang San', EntityType.PERSON),
  ]);
  check('values differing in case and spacing share a group, per type', groups.map(g => [g.type, g.text, g.ids.length]), [
    [EntityType.PERSON, 'Zhang San', 3],
    [EntityType.PERSON, 'Li Si', 1],
    [EntityType.ORGANIZATION, 'Zhang San', 1],
  ]);
  check('a partly selected group is not selected', groups[0].selected, false);
  check('contexts are capped at three', groups[0].contexts.length, 3);
}

console.log('\n=== allSelected ===');
check('none selected', allSelected([entity('a', EntityType.DATE)]), false);
check('all selected', allSelected([entity('a', EntityType.DATE, 'confirmed')]), true);
check('nothing to select', allSelected([]), false);

console.log('\n=== applyDefaultSelection ===');
check(
  'structured types start selected; names, places, and dates wait for the user',
  applyDefaultSelection([
    entity('138 0013 8000', EntityType.PHONE),
    entity('a@b.com', EntityType.EMAIL),
    entity('Zhang San', EntityType.PERSON),
    entity('1992-06-18', EntityType.DATE),
    entity('Secret', EntityType.PREDEFINED),
  ]).map(e => e.status),
  ['confirmed', 'confirmed', 'rejected', 'rejected', 'confirmed'],
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
