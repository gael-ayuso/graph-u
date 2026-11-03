import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const repo = process.argv[2];
const job = process.argv[3];
const sharp = createRequire(import.meta.url)(path.join(repo, 'node_modules/sharp'));
async function main() {
  const output = path.join(job, 'ascii-frames');
  await fs.mkdir(output, { recursive: true });
  for (let sheet = 0; sheet < 4; sheet++) {
    const filename = path.join(job, 'ascii-sheets', 'sheet-' + sheet + '.png');
    const info = await sharp(filename).metadata();
    if (info.width % 6 || info.height % 4 || info.width / 6 !== info.height / 4) throw new Error('Unexpected sheet size; refusing an inaccurate crop.');
    const width = info.width / 6;
    for (let index = 0; index < 24; index++) {
      const frame = sheet * 24 + index;
      await sharp(filename).extract({ left: index % 6 * width, top: Math.floor(index / 6) * width, width, height: width }).png().toFile(path.join(output, 'frame-' + String(frame).padStart(3, '0') + '.png'));
    }
  }
  console.log('Extracted 96 ASCII Magic frames without resampling.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
