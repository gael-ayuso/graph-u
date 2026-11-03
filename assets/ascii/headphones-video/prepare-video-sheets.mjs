import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const repo = process.argv[2];
const job = process.argv[3];
const sharp = createRequire(import.meta.url)(path.join(repo, 'node_modules/sharp'));
async function main() {
  const files = (await fs.readdir(path.join(job, 'frames'))).filter(f => /^frame-\d{3}\.png$/.test(f)).sort();
  if (files.length !== 96) throw new Error('Expected exactly 96 source frames, received ' + files.length);
  const output = path.join(job, 'source-sheets');
  await fs.mkdir(output, { recursive: true });
  for (let sheet = 0; sheet < 4; sheet++) {
    const composite = [];
    for (let index = 0; index < 24; index++) {
      const frame = sheet * 24 + index;
      const input = await sharp(path.join(job, 'frames', files[frame])).resize(512, 512, { fit: 'contain', background: '#000000' }).flatten({ background: '#000000' }).png().toBuffer();
      composite.push({ input, left: index % 6 * 512, top: Math.floor(index / 6) * 512 });
    }
    const filename = path.join(output, 'sheet-' + sheet + '.png');
    await sharp({ create: { width: 3072, height: 2048, channels: 3, background: '#000000' } }).composite(composite).png().toFile(filename);
    console.log(JSON.stringify({ sheet, file: filename, firstFrame: sheet * 24, lastFrame: sheet * 24 + 23 }));
  }
  await fs.writeFile(path.join(job, 'ascii-pipeline.json'), JSON.stringify({ frames: 96, fps: 24, frameWidth: 512, frameHeight: 512, columns: 6, rows: 4, sheets: 4 }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
