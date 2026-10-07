// Optional real-OCR regression: start `npm run dev`, then run this with Playwright installed.
// PLAYWRIGHT_MODULE can point to an existing Playwright module; CHROME_EXECUTABLE_PATH
// can select an existing browser. Requires network access for the OCR runtime/models.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.TEST_BASE_URL || 'http://127.0.0.1:5173');
  const results = await page.evaluate(async () => {
    const { processImage } = await import('/src/lib/image/ImageProcessor.ts');
    const { redactImage } = await import('/src/lib/image/ImageRedactor.ts');
    const results = [];
    for (const language of ['english', 'chinese']) {
      for (const angle of [0, 90, 180, 270]) {
        const canvas = document.createElement('canvas');
        canvas.width = angle % 180 ? 400 : 1000;
        canvas.height = angle % 180 ? 1000 : 400;
        const context = canvas.getContext('2d');
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(angle * Math.PI / 180);
        context.translate(-500, -200);
        context.fillStyle = 'black';
        context.font = '32px Arial';
        const lines = language === 'english'
          ? ['DEMO DOCUMENT FOR OCR TESTING', 'Contact: demo@example.com', 'Reference: ID-DEMO-XXXX', 'Please review this sample document.']
          : ['测试文档 示例信息', 'Contact: demo@example.com', '编号：ID-DEMO-XXXX', '请检查图片中的文字和遮盖区域'];
        lines.forEach((text, i) => context.fillText(text, 40, 70 + i * 70));
        const blob = await new Promise(resolve => canvas.toBlob(resolve));
        const progress = [];
        const doc = await processImage(new File([blob], 'DEMO.png', { type: 'image/png' }), value => progress.push(value));
        const email = doc.allEntities.find(entity => entity.text === 'demo@example.com');
        if (!email) throw new Error(`Email missing: ${language}, ${angle} degrees`);

        // Build an independent mask from the known email glyphs, rather than from OCR boxes.
        const mask = document.createElement('canvas');
        mask.width = canvas.width;
        mask.height = canvas.height;
        const maskContext = mask.getContext('2d');
        maskContext.setTransform(context.getTransform());
        maskContext.font = context.font;
        maskContext.fillText('demo@example.com', 40 + context.measureText('Contact: ').width, 140);
        const maskPixels = maskContext.getImageData(0, 0, mask.width, mask.height).data;
        const redacted = await redactImage(doc.pages[0].imageBlob, [email]);
        const bitmap = await createImageBitmap(redacted);
        if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) throw new Error('Export dimensions changed');
        const output = document.createElement('canvas');
        output.width = bitmap.width;
        output.height = bitmap.height;
        const outputContext = output.getContext('2d');
        outputContext.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = outputContext.getImageData(0, 0, output.width, output.height).data;
        const source = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        const box = email.position.boundingBox;
        const top = canvas.height - box.y - box.height;
        let glyphPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const x = (i / 4) % canvas.width;
          const y = Math.floor(i / 4 / canvas.width);
          if (maskPixels[i + 3] > 128) {
            glyphPixels++;
            if (x < box.x - 2 || x >= box.x + box.width + 2 || y < top - 2 || y >= top + box.height + 2) {
              throw new Error(`Email glyph outside redaction: ${language}, ${angle}`);
            }
            if (pixels[i] || pixels[i + 1] || pixels[i + 2]) throw new Error('Email glyph not covered by black pixels');
          }
          if (x < box.x - 3 || x > box.x + box.width + 3 || y < top - 3 || y > top + box.height + 3) {
            if (pixels[i] !== source[i] || pixels[i + 1] !== source[i + 1] || pixels[i + 2] !== source[i + 2]) {
              throw new Error('Pixels outside redaction changed');
            }
          }
        }
        if (!glyphPixels) throw new Error('Empty glyph mask');
        results.push({ language, angle, text: doc.pages[0].textContent, glyphPixels, progress });
      }
    }
    return results;
  });
  for (const result of results) {
    assert.match(result.text, /demo@example\.com/);
    assert.ok(result.progress.every((value, i) => i === 0 || value >= result.progress[i - 1]));
    assert.equal(result.progress.at(-1), 100);
    console.log(`${result.language}, ${result.angle} degrees: OCR and ${result.glyphPixels} redacted glyph pixels passed`);
  }
} finally {
  await browser.close();
}
