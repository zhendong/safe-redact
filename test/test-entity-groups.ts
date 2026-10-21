/**
 * Tests for grouping detections by value and the starting selection on the Choose screen,
 * and for migrating the entity types in saved settings
 */
import { allSelected, applyDefaultSelection, groupByValue } from '../src/utils/entity-groups';
import { enableNewEntityTypes } from '../src/utils/entity-types';
import { EntityType, type DetectedEntity, type DetectionConfig } from '../src/lib/types';

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

console.log('\n=== enableNewEntityTypes ===');
const allTypes = Object.values(EntityType);
const typesWithSsn = allTypes.map(type => (type === EntityType.ID_NUMBER ? 'SSN' : type));
const saved = (enabled: string[], known?: string[]) =>
  ({ enabledEntityTypes: enabled, knownEntityTypes: known } as unknown as DetectionConfig);
const enabledAfterLoad = (config: DetectionConfig) => [...enableNewEntityTypes(config).enabledEntityTypes].sort();
check(
  'saved SSN becomes ID',
  enabledAfterLoad(saved(['PERSON', 'SSN'], typesWithSsn)),
  ['ID', 'PERSON'],
);
check(
  'ID stays enabled when only Custom, which had the other ID rules, was enabled',
  enabledAfterLoad(saved(['CUSTOM'], typesWithSsn)),
  ['CUSTOM', 'ID'],
);
check(
  'ID stays off when SSN and Custom were both off',
  enabledAfterLoad(saved(['PERSON'], typesWithSsn)),
  ['PERSON'],
);
check(
  'settings from before knownEntityTypes: SSN becomes ID and PREDEFINED is new',
  enabledAfterLoad(saved(['SSN'])),
  ['ID', 'PREDEFINED'],
);
check(
  'current settings are left alone',
  enabledAfterLoad(saved(['PERSON'], allTypes)),
  ['PERSON'],
);
check('every type is known after loading', enableNewEntityTypes(saved(['SSN'], typesWithSsn)).knownEntityTypes, allTypes);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
