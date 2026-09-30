import test from 'node:test';
import assert from 'node:assert/strict';
import { runBounded, serialQueue } from '../scripts/concurrency.mjs';
const turn = () => new Promise(resolve => setImmediate(resolve));

test('independent jobs run at most twice in parallel and publication is serial', async () => {
  const publish = serialQueue(), seen = [], published = [];
  let running = 0, peak = 0, writing = 0, writingPeak = 0;
  await runBounded([0, 1, 2, 3, 4], 2, async job => {
    seen.push(job); peak = Math.max(peak, ++running);
    await turn();
    await publish(async () => {
      writingPeak = Math.max(writingPeak, ++writing);
      await turn(); published.push(job); --writing;
    });
    --running;
  });
  assert.equal(peak, 2); assert.equal(writingPeak, 1);
  assert.deepEqual(seen.sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual(published.sort(), [0, 1, 2, 3, 4]);
});
test('failed job stops new scheduling but preserves other in-flight work', async () => {
  const started = [], completed = [];
  await assert.rejects(runBounded([0, 1, 2, 3], 2, async job => {
    started.push(job); await turn();
    if (job === 0) throw new Error('review rejected');
    completed.push(job);
  }), /review rejected/);
  assert.deepEqual(started, [0, 1]); assert.deepEqual(completed, [1]);
});
