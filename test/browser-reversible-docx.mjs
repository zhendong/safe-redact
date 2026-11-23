// Start `npm run dev` first. PLAYWRIGHT_MODULE and CHROME_EXECUTABLE_PATH can
// point to an existing Playwright install and browser (as in the other browser tests).
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const { prepareDocxReplacement, createReversibleDocx, restoreDocx } = await import('/src/lib/redaction/reversible/docx.ts');
    const { extendMappings, detectReplacementLanguage, validateMappings } = await import('/src/lib/redaction/reversible/mappings.ts');
    const { saveReplacementRecord, listReplacementRecords, deleteReplacementRecord } = await import('/src/lib/redaction/reversible/store.ts');
    const { EntityType } = await import('/src/lib/types/index.ts');
    const { generateRecordName } = await import('/src/utils/file-utils.ts');
    const { default: PizZip } = await import('/node_modules/.vite/deps/pizzip.js');
    const namespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const checks = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
    check(generateRecordName('项目报告.docx') === '项目报告', 'record names come from the filename');
    const longName = generateRecordName('a'.repeat(199) + '😀.docx');
    check(longName.length <= 200 && !/[\uD800-\uDBFF]$/.test(longName), 'automatic names fit the store without splitting Unicode');
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const run = text => `<w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
    const xml = contents => `<w:document xmlns:w="${namespace}"><w:body>${contents}<w:sectPr/></w:body></w:document>`;
    const paragraph = contents => `<w:p>${contents}</w:p>`;
    const source = xml(paragraph(run('Alice met Bob at Acme. Alice agreed.')));
    const text = value => [...new DOMParser().parseFromString(value, 'text/xml').getElementsByTagNameNS(namespace, 't')].map(node => node.textContent).join('');
    const entity = (value, start, type = EntityType.PERSON) => ({
      id: crypto.randomUUID(), text: value, entityType: type, status: 'confirmed', confidence: 1, detectionMethod: 'manual',
      position: { textIndex: start, pageNumber: 1, boundingBox: { x: 0, y: 0, width: 0, height: 0 } },
    });
    const packageDocx = documentXml => {
      const zip = new PizZip();
      zip.file('word/document.xml', documentXml);
      zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      return zip;
    };
    const file = (zip, name = 'test.docx') => new File([zip.generate({ type: 'uint8array' })], name, { type: mime });
    const entities = [entity('Alice', 0), entity('Acme', 17, EntityType.ORGANIZATION), entity('Alice', 23)];
    const first = prepareDocxReplacement(source, entities);
    check(text(first.documentXml) === '[Person A] met Bob at [Company A]. [Person A] agreed.', 'readable labels and repeated originals');
    check(first.mappings.length === 2 && first.redactedCount === 3, 'unique mappings, occurrence counts');
    for (const [description, badMappings] of [
      ['one original assigned two labels', [
        { original: 'Alice', replacement: '[Person A]', entityType: EntityType.PERSON },
        { original: 'Alice', replacement: '[Person B]', entityType: EntityType.PERSON },
      ]],
      ['one label assigned two originals', [
        { original: 'Alice', replacement: '[Person A]', entityType: EntityType.PERSON },
        { original: 'Bob', replacement: '[Person A]', entityType: EntityType.PERSON },
      ]],
    ]) {
      try { validateMappings(badMappings); throw new Error('ambiguous mappings accepted'); }
      catch (error) { check(error.code === 'invalid', `validation rejects ${description}`); }
      try { await saveReplacementRecord('Invalid mapping', badMappings); throw new Error('ambiguous record saved'); }
      catch (error) { check(error.code === 'invalid', `save rejects ${description}`); }
      try { await restoreDocx(file(packageDocx(first.documentXml)), badMappings); throw new Error('ambiguous restore accepted'); }
      catch (error) { check(error.code === 'invalid', `restore rejects ${description}`); }
    }
    const aliases = extendMappings([], [
      { original: 'IBM', entityType: EntityType.ORGANIZATION },
      { original: 'International Business Machines', entityType: EntityType.ORGANIZATION },
      { original: 'Alice', entityType: EntityType.PERSON },
      { original: 'ALICE', entityType: EntityType.PERSON },
    ], '');
    check(new Set(aliases.map(mapping => mapping.replacement)).size === 4, 'aliases and case variants retain separate exact-text mappings');
    const mutable = first.mappings.map(mapping => ({ ...mapping }));
    const savingSnapshot = saveReplacementRecord('Snapshot record', mutable);
    mutable[0].original = 'Changed after validation';
    mutable.push({ original: 'Bob', replacement: mutable[0].replacement, entityType: EntityType.PERSON });
    const snapshotRecord = await savingSnapshot;
    check(snapshotRecord.mappings.length === 2 && snapshotRecord.mappings[0].original === 'Alice', 'save cannot persist mutations made after validation');
    await deleteReplacementRecord(snapshotRecord);
    const restoreMappings = first.mappings.map(mapping => ({ ...mapping }));
    const restoringSnapshot = restoreDocx(file(packageDocx(first.documentXml)), restoreMappings);
    restoreMappings[0].original = 'Changed during restoration';
    const stableRestore = await restoringSnapshot;
    check(text(new PizZip(await stableRestore.blob.arrayBuffer()).file('word/document.xml').asText()) === text(source), 'restore uses the validated mapping snapshot');
    const record = await saveReplacementRecord('  Contract  ', first.mappings);
    check(record.name === 'Contract' && record.revision === 1, 'named local record');

    const second = prepareDocxReplacement(source, [...entities, entity('Bob', 10)]);
    check(text(second.documentXml) === '[Person A] met [Person B] at [Company A]. [Person A] agreed.', 'fresh export has its own complete mappings');
    const secondRecord = await saveReplacementRecord('Contract', second.mappings);
    check(secondRecord.name === record.name && secondRecord.id !== record.id, 'same filename creates independent records');
    check(JSON.stringify((await listReplacementRecords()).find(item => item.id === record.id)) === JSON.stringify(record), 'new export leaves earlier record unchanged');
    const reused = prepareDocxReplacement(source, entities, secondRecord.mappings);
    check(JSON.stringify(reused.mappings) === JSON.stringify(secondRecord.mappings), 'reprocessing original reuses existing mappings');
    const oldExport = await restoreDocx(file(packageDocx(first.documentXml)), record.mappings);
    check(text(new PizZip(await oldExport.blob.arrayBuffer()).file('word/document.xml').asText()) === 'Alice met Bob at Acme. Alice agreed.', 'earlier record still restores its export');

    const edited = packageDocx(xml(paragraph(run('Revised: [Per') + '<w:r><w:rPr><w:b/></w:rPr><w:t>son A]</w:t></w:r>' + run(' approves [Company A]. [Person B] agrees. [Person AA] stays.'))));
    edited.file('word/header1.xml', `<w:hdr xmlns:w="${namespace}">${paragraph(run('[Person A]'))}</w:hdr>`);
    edited.file('word/footer1.xml', `<w:ftr xmlns:w="${namespace}">${paragraph(run('[Company A]'))}</w:ftr>`);
    const restored = await restoreDocx(file(edited), secondRecord.mappings);
    const restoredZip = new PizZip(await restored.blob.arrayBuffer());
    check(text(restoredZip.file('word/document.xml').asText()) === 'Revised: Alice approves Acme. Bob agrees. [Person AA] stays.', 'restore edited DOCX across formatting runs preserves edits');
    check(restored.restoredCount === 5 && restored.unknown[0] === '[Person AA]', 'restore story parts and report unknown labels');
    check(restoredZip.file('word/document.xml').asText().includes('<w:b'), 'preserve formatting');

    const barriers = packageDocx(xml(paragraph(run('[Person') + '<w:r><w:tab/></w:r>' + run(' A]')) + paragraph(run('[Person')) + paragraph(run(' A]'))));
    const barrierResult = await restoreDocx(file(barriers), secondRecord.mappings);
    check(barrierResult.restoredCount === 0, 'never restore across tabs or paragraphs');
    const splitSource = xml(paragraph(run('Al') + '<w:r><w:rPr><w:i/></w:rPr><w:t>ice</w:t></w:r>' + run(' & 张三')));
    const split = prepareDocxReplacement(splitSource, [entity('Al ice', 0), entity('张三', 10)]);
    check(split.mappings[0].original === 'Alice', 'store real original without synthetic parser spaces');
    const splitRestored = await restoreDocx(file(packageDocx(split.documentXml)), split.mappings);
    check(text(new PizZip(await splitRestored.blob.arrayBuffer()).file('word/document.xml').asText()) === 'Alice & 张三', 'unicode and XML escaping round trip');
    const collision = extendMappings([], [{ original: 'Alice', entityType: EntityType.PERSON }], 'Already [Person A]');
    check(collision[0].replacement === '[Person B]', 'avoid labels already present in source');
    const reservedSource = xml(paragraph(run('[Email A] Alice')));
    const reservedPlan = prepareDocxReplacement(reservedSource, [entity('Alice', 10)]);
    const reservedRecord = await saveReplacementRecord('Reserved labels', reservedPlan.mappings, reservedPlan.reservedLabels);
    const laterPlan = prepareDocxReplacement(xml(paragraph(run('alice@example.com'))),
      [entity('alice@example.com', 0, EntityType.EMAIL)], reservedRecord.mappings, reservedRecord.reservedLabels);
    check(laterPlan.mappings.find(mapping => mapping.entityType === EntityType.EMAIL).replacement === '[Email B]', 'reserve source labels across later passes and entity types');
    const laterRecord = await saveReplacementRecord('Reserved labels', laterPlan.mappings, laterPlan.reservedLabels);
    const reservedRestore = await restoreDocx(file(packageDocx(reservedPlan.documentXml)), laterRecord.mappings);
    check(text(new PizZip(await reservedRestore.blob.arrayBuffer()).file('word/document.xml').asText()) === '[Email A] Alice', 'later merges never capture literal labels in earlier exports');
    await deleteReplacementRecord(laterRecord);
    await deleteReplacementRecord(reservedRecord);
    const alphabet = extendMappings([], Array.from({ length: 28 }, (_, i) => ({ original: `name ${i}`, entityType: EntityType.PERSON })), '');
    check(alphabet[25].replacement === '[Person Z]' && alphabet[26].replacement === '[Person AA]', 'labels extend beyond Z');
    check(detectReplacementLanguage('这是一份中文协议，请联系 alice@example.com 或 https://example.com.') === 'zh', 'Chinese detection ignores Latin contact details');
    check(detectReplacementLanguage('This contract involves 张三 and the company.') === 'en', 'English documents with Chinese names remain English');
    check(detectReplacementLanguage('张三') === 'zh', 'short Chinese text is detected');
    const chineseSource = xml(paragraph(run('张三与星舟公司签署本次股权合作协议，张三确认条款。')));
    const chineseEntities = [entity('张三', 0), entity('星舟公司', 3, EntityType.ORGANIZATION), entity('张三', 18)];
    const chinesePlan = prepareDocxReplacement(chineseSource, chineseEntities);
    check(text(chinesePlan.documentXml) === '[人员1]与[公司1]签署本次股权合作协议，[人员1]确认条款。', 'Chinese documents use meaningful Chinese labels');
    const chineseRestore = await restoreDocx(file(packageDocx(chinesePlan.documentXml)), chinesePlan.mappings);
    check(text(new PizZip(await chineseRestore.blob.arrayBuffer()).file('word/document.xml').asText()) === text(chineseSource), 'Chinese labels restore exactly');
    const overridden = prepareDocxReplacement(chineseSource, chineseEntities, [], [], 'en');
    check(text(overridden.documentXml).includes('[Person A]'), 'document language can be overridden');
    const unchanged = prepareDocxReplacement(chineseSource, chineseEntities.map(entity => ({ ...entity, replacementType: EntityType.CUSTOM })), chinesePlan.mappings, [], 'en');
    check(JSON.stringify(unchanged.mappings) === JSON.stringify(chinesePlan.mappings), 'saved labels and types survive language or type changes');
    const typed = prepareDocxReplacement(xml(paragraph(run('Acme'))), [{ ...entity('Acme', 0, EntityType.CUSTOM), replacementType: EntityType.ORGANIZATION }]);
    check(typed.mappings[0].replacement === '[Company A]' && typed.mappings[0].entityType === EntityType.ORGANIZATION, 'chosen replacement type overrides generic detection');
    check(extendMappings([], [{ original: '张三', entityType: EntityType.PERSON }], '[人员1] 张三', [], 'zh')[0].replacement === '[人员2]', 'Chinese label collisions are skipped');
    const chineseSecond = prepareDocxReplacement(xml(paragraph(run('[人员1]与李四确认协议。'))), [entity('人员1', 1), entity('李四', 6)], chinesePlan.mappings);
    check(chineseSecond.protectedCount === 1 && text(chineseSecond.documentXml).includes('[人员2]'), 'Chinese labels are protected on later passes');
    const mixed = await restoreDocx(file(packageDocx(xml(paragraph(run('[人员1] and [Person A] [公司9]'))))), [...chinesePlan.mappings, { original: 'Alice', replacement: '[Person A]', entityType: EntityType.PERSON }]);
    check(mixed.restoredCount === 2 && mixed.unknown.includes('[公司9]'), 'mixed language records restore known labels and report unknown labels');

    const snapshot = { zip: packageDocx(source), documentXml: source, allEntities: entities };
    const originalZip = snapshot.zip.generate({ type: 'base64' });
    await createReversibleDocx(snapshot, first, true);
    await createReversibleDocx(snapshot, first, false);
    check(snapshot.zip.generate({ type: 'base64' }) === originalZip && snapshot.documentXml === source, 'exports with and without metadata stripping preserve original review snapshot');

    try { prepareDocxReplacement(source, [entity('Alice met', 0), entity('met Bob', 6)]); throw new Error('overlap accepted'); }
    catch (error) { check(error.code === 'overlap', 'partial overlapping selections block export'); }
    try { prepareDocxReplacement(source, [entity('Wrong original', 0)]); throw new Error('stale offset accepted'); }
    catch (error) { check(error.code === 'invalid', 'stale offsets block export'); }
    for (const contents of [paragraph(run('Alice')) + paragraph(run('Bob')), paragraph(run('Alice') + '<w:r><w:tab/></w:r>' + run('Bob'))]) {
      try { prepareDocxReplacement(xml(contents), [entity('Alice Bob', 0)]); throw new Error('structural selection accepted'); }
      catch (error) { check(error.code === 'boundary', 'replacements cannot flatten paragraph or tab boundaries'); }
    }
    try { await saveReplacementRecord(' ', []); throw new Error('blank name accepted'); }
    catch (error) { check(error.code === 'name', 'blank record names rejected'); }

    const concurrent = await Promise.all([
      saveReplacementRecord('Contract', secondRecord.mappings),
      saveReplacementRecord('Contract', secondRecord.mappings),
    ]);
    check(concurrent[0].id !== concurrent[1].id, 'concurrent exports create distinct records');
    const realNow = Date.now;
    let other;
    try {
      Date.now = () => 1;
      other = await saveReplacementRecord('Other record', []);
    } finally { Date.now = realNow; }
    check(other.createdAt > concurrent[1].createdAt, 'creation order survives clock rollback');
    check((await listReplacementRecords())[0].id === other.id, 'newest-created record appears first');
    await deleteReplacementRecord(other);
    for (const item of concurrent) await deleteReplacementRecord(item);
    await deleteReplacementRecord(record);
    check((await listReplacementRecords()).length === 1, 'delete removes only selected records');
    return { count: checks.length, id: secondRecord.id, name: secondRecord.name,
      fixture: packageDocx(xml(paragraph(run('alice@example.com and bob@example.com')))).generate({ type: 'base64' }),
      chineseFixture: packageDocx(xml(paragraph(run('张三就本次股权合作协议联系 alice@example.com，双方确认具体安排。')))).generate({ type: 'base64' }) };
  });
  await page.reload();
  const persisted = await page.evaluate(async () => {
    const { listReplacementRecords } = await import('/src/lib/redaction/reversible/store.ts');
    return (await listReplacementRecords()).map(record => ({ id: record.id, name: record.name, count: record.mappings.length }));
  });
  assert.deepEqual(persisted, [{ id: result.id, name: result.name, count: 3 }]);

  const upgrade = await browser.newPage();
  await upgrade.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  const migrated = await upgrade.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('saferedact-replacements', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      transaction.objectStore('records').put({ id: 'existing', name: 'Existing record', createdAt: 1, updatedAt: 1, revision: 1,
        mappings: [{ original: 'Alice', replacement: '[Person A]', entityType: 'PERSON' }] });
      transaction.oncomplete = resolve;
      transaction.onabort = reject;
    });
    db.close();
    const { listReplacementRecords, saveReplacementRecord } = await import('/src/lib/redaction/reversible/store.ts');
    const [record] = await listReplacementRecords();
    await saveReplacementRecord('New export', record.mappings);
    const existing = (await listReplacementRecords()).find(item => item.id === 'existing');
    return { name: existing.name, original: existing.mappings[0].original, revision: existing.revision };
  });
  assert.deepEqual(migrated, { name: 'Existing record', original: 'Alice', revision: 1 });

  // Failed storage must reject; it must never look like a saved mapping.
  const unavailable = await browser.newPage();
  await unavailable.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  const code = await unavailable.evaluate(async () => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    const { saveReplacementRecord } = await import('/src/lib/redaction/reversible/store.ts');
    try { await saveReplacementRecord('Cannot save', []); return 'unexpected success'; }
    catch (error) { return error.code; }
  });
  assert.equal(code, 'storage');
  await unavailable.addInitScript(() => {
    localStorage.setItem('safe-redact-language', 'en');
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  await unavailable.reload();
  let failedDownloads = 0;
  unavailable.on('download', () => failedDownloads++);
  await unavailable.locator('#file-input').setInputFiles({ name: 'cannot-save.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(result.fixture, 'base64') });
  await unavailable.getByRole('button', { name: /Check document/ }).click();
  await unavailable.getByRole('button', { name: 'Save & replace (2)', exact: true }).click();
  await unavailable.getByRole('button', { name: 'Save & replace (2)', exact: true }).waitFor();
  assert.match(await unavailable.locator('main').innerText(), /Cannot access local records/);
  assert.equal(failedDownloads, 0, 'default DOCX export never falls back when local storage fails');

  // Exercise React integration too: a second export must update the selected
  // record, and returning from export must retain the record while its list loads.
  const ui = await browser.newPage();
  await ui.addInitScript(() => localStorage.setItem('safe-redact-language', 'en'));
  await ui.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.continue() : route.abort());
  await ui.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  assert.equal(await ui.getByText('Records & restore', { exact: true }).count(), 0);
  await ui.locator('#file-input').setInputFiles({ name: 'contract.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(result.fixture, 'base64') });
  await ui.getByRole('button', { name: /Check document/ }).click();
  const recordsSummary = ui.locator('summary').filter({ hasText: 'Records & restore' });
  assert.equal(await recordsSummary.evaluate(element => element.parentElement.open), false, 'records panel starts closed');
  await ui.getByRole('checkbox', { name: 'Email: bob@example.com', exact: true }).uncheck();
  assert.equal(await ui.getByRole('checkbox', { name: /Use reversible replacements for this DOCX/ }).count(), 0, 'there is no DOCX mode toggle');
  assert.match(await ui.locator('.docx-content').innerText(), /\[Email A\]/, 'numbered labels appear without opting in');
  assert.doesNotMatch(await ui.locator('.docx-content').innerText(), /\[EMAIL\]/);
  const recordSelect = ui.getByLabel('Record', { exact: true });
  assert.equal(await recordSelect.locator('option:checked').textContent(), 'Choose record');
  assert.equal(await recordSelect.locator('option').filter({ hasText: /New —/ }).count(), 0, 'selector is for restoring only');
  assert.equal(await ui.getByText('Newest first.', { exact: true }).count(), 0);
  assert.equal(await ui.locator('input[type="search"]').count(), 0, 'record search is removed');
  assert.equal(await ui.getByLabel('Record name', { exact: true }).count(), 0, 'record names cannot be edited');
  assert.equal(await ui.getByRole('button', { name: /Edit name|Save name|Use name/ }).count(), 0);
  await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'Save & replace (1)', exact: true }).click()]);
  await ui.getByRole('button', { name: 'Back to Review', exact: true }).click();
  const recordId = await recordSelect.inputValue();
  assert.ok(recordId, 'saved record remains selected after returning to review');
  assert.match(await recordSelect.locator('option:checked').textContent(), /contract/, 'default record name is saved automatically');
  const bobType = ui.getByRole('combobox', { name: /Replacement type.*bob@example\.com/ });
  await bobType.selectOption('ORG');
  assert.equal(await recordsSummary.evaluate(element => element.parentElement.open), false, 'type edits do not open the records panel');
  await ui.getByRole('button', { name: /Undo/ }).click();
  assert.equal(await bobType.inputValue(), 'EMAIL', 'type edits support undo');
  await bobType.selectOption('ORG');
  await ui.getByRole('checkbox', { name: 'Email: bob@example.com', exact: true }).check();
  assert.match(await ui.locator('.docx-content').innerText(), /\[Company A\]/);
  const [download] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'Save & replace (2)', exact: true }).click()]);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  await ui.getByRole('button', { name: 'Back to Review', exact: true }).click();
  const secondRecordId = await recordSelect.inputValue();
  assert.notEqual(secondRecordId, recordId, 'each export selects its newly created restore record');
  assert.equal(await recordsSummary.evaluate(element => element.parentElement.open), false, 'records panel remains closed after export');
  const uiRecords = await ui.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords())
    .map(record => ({ id: record.id, count: record.mappings.length })));
  assert.deepEqual(uiRecords, [{ id: secondRecordId, count: 2 }, { id: recordId, count: 1 }]);
  await recordsSummary.click();
  assert.equal(await ui.getByRole('button', { name: /Edit name|Save name|Use name/ }).count(), 0);
  const beforeReuse = await ui.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords()));
  await recordSelect.selectOption('');
  const previewBeforeSelection = await ui.locator('.docx-content').innerText();
  await recordSelect.selectOption(recordId);
  assert.equal(await ui.locator('.docx-content').innerText(), previewBeforeSelection, 'restore record selection cannot affect replacement preview');
  await recordSelect.selectOption(secondRecordId);
  const afterReuse = await ui.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords()));
  assert.deepEqual(afterReuse, beforeReuse, 'selecting a restore record does not write to it');
  const { default: PizZip } = await import('pizzip');
  const edited = new PizZip(Buffer.concat(chunks));
  edited.file('word/document.xml', edited.file('word/document.xml').asText().replace('[Email A]', 'Revised: [Email A]'));
  await ui.getByLabel('Choose DOCX', { exact: true }).setInputFiles({ name: 'edited.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: edited.generate({ type: 'nodebuffer' }) });
  await ui.getByRole('button', { name: 'Preview restore', exact: true }).click();
  await ui.getByText('2 matches, 0 missing labels.', { exact: true }).waitFor();
  const [restoredDownload] = await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'Download restored', exact: true }).click()]);
  const restoredChunks = [];
  for await (const chunk of await restoredDownload.createReadStream()) restoredChunks.push(chunk);
  const restoredXml = new PizZip(Buffer.concat(restoredChunks)).file('word/document.xml').asText();
  assert.match(restoredXml, /Revised: alice@example.com and bob@example.com/);
  assert.doesNotMatch(restoredXml, /\[(?:Email|Company) [AB]\]/);
  const afterRestoration = await ui.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords()));
  assert.deepEqual(afterRestoration, beforeReuse, 'restoring a document does not modify its record');
  await recordSelect.selectOption(recordId);
  await Promise.all([ui.waitForEvent('download'), ui.getByRole('button', { name: 'Save & replace (2)', exact: true }).click()]);
  await ui.getByRole('button', { name: 'Back to Review', exact: true }).click();
  const afterRepeatExport = await ui.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords()));
  assert.equal(afterRepeatExport.length, 3, 'exporting with an older restore record selected still creates a new record');
  assert.deepEqual(afterRepeatExport.slice(1), beforeReuse, 'all earlier records remain unchanged after another export');
  assert.notEqual(afterRepeatExport[0].id, secondRecordId);

  const zh = await browser.newPage();
  await zh.addInitScript(() => localStorage.setItem('safe-redact-language', 'en'));
  await zh.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await zh.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  await zh.locator('#file-input').setInputFiles({ name: 'chinese.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(result.chineseFixture, 'base64') });
  await zh.getByRole('button', { name: /Check document/ }).click();
  assert.equal(await zh.getByRole('checkbox', { name: /Use reversible replacements for this DOCX/ }).count(), 0);
  const chineseSummary = zh.locator('summary').filter({ hasText: 'Records & restore' });
  assert.equal(await chineseSummary.evaluate(element => element.parentElement.open), false);
  assert.match(await zh.locator('.docx-content').innerText(), /\[邮箱1\]/, 'localized labels work with the records panel closed');
  await chineseSummary.click();
  await zh.getByRole('combobox', { name: 'Label language', exact: true }).waitFor();
  assert.match(await zh.locator('.docx-content').innerText(), /\[邮箱1\]/, 'Chinese document uses Chinese labels with English interface');
  await zh.locator('.docx-content').scrollIntoViewIfNeeded();
  await zh.evaluate(() => {
    const container = document.querySelector('.docx-content');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const start = node.data.indexOf('张三');
      if (start === -1) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 2);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
      break;
    }
  });
  const manualType = zh.getByRole('combobox', { name: 'Replacement type', exact: true });
  await manualType.focus();
  await manualType.selectOption('PERSON');
  await zh.getByRole('button', { name: 'Redact', exact: true }).click();
  assert.match(await zh.locator('.docx-content').innerText(), /\[人员1\]/, 'manual selection type is applied');
  const language = zh.getByRole('combobox', { name: 'Label language', exact: true });
  await language.selectOption('en');
  assert.match(await zh.locator('.docx-content').innerText(), /\[Person A\]/);
  await language.selectOption('auto');
  assert.match(await zh.locator('.docx-content').innerText(), /\[人员1\]/);
  assert.equal(await zh.getByLabel('Record', { exact: true }).locator('option:checked').textContent(), 'Choose record');
  assert.equal(await zh.getByLabel('Record name', { exact: true }).count(), 0);
  const notYetSaved = await zh.evaluate(async () => (await (await import('/src/lib/redaction/reversible/store.ts')).listReplacementRecords()).length);
  assert.equal(notYetSaved, 0, 'new records are saved only when applying replacements');
  const [chineseDownload] = await Promise.all([zh.waitForEvent('download'), zh.getByRole('button', { name: 'Save & replace (2)', exact: true }).click()]);
  const chineseChunks = [];
  for await (const chunk of await chineseDownload.createReadStream()) chineseChunks.push(chunk);
  await zh.getByRole('button', { name: 'Back to Review', exact: true }).click();
  assert.equal(await zh.getByRole('combobox', { name: /Replacement type.*张三/ }).isEnabled(), true, 'new exports can use new types without changing earlier records');
  assert.equal(await chineseSummary.evaluate(element => element.parentElement.open), false);
  await chineseSummary.click();
  await zh.getByLabel('Choose DOCX', { exact: true }).setInputFiles({ name: 'chinese-redacted.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.concat(chineseChunks) });
  await zh.getByRole('button', { name: 'Preview restore', exact: true }).click();
  await zh.getByText('2 matches, 0 missing labels.', { exact: true }).waitFor();
  console.log(`Reversible DOCX passed (${result.count + 3} core checks plus English / Chinese type selection, language override, and independent export / restore UI flows)`);
} finally {
  await browser.close();
}
