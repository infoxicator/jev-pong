import { expect, test } from '@playwright/test';
import { BENCHMARK_PACE, makeTrials, playTrial, type ReplayFile } from '../src/benchmark';

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

test('replays a model’s shot and landing without opening a live match', async ({ page }) => {
  const trial = makeTrials(2).find(trial => trial.id === 'recovery 1' && trial.side === 'right')!;
  const drop = trial.read.options.find(option => option.shot === 'drop')!;
  const replay: ReplayFile = {
    format: 'jev-benchmark-replay-v1',
    pace: BENCHMARK_PACE,
    clips: [{
      player: 'Jev fixture',
      scenario: trial.id,
      side: trial.side,
      shot: drop.shot,
      ...playTrial(trial.game, trial.side, drop.shot, drop.lane, true),
    }],
  };
  const sockets: string[] = [], errors: string[] = [];
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/arena3d.html?benchmark');
  await expect(page.getByRole('heading', { name: 'Decision benchmark' })).toBeVisible();
  const input = page.getByLabel('Replay file');
  const status = page.getByRole('status');
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(status).toContainText('Select a replay JSON');
  await input.setInputFiles({ name: 'benchmark-replay.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replay)) });
  await expect(page.getByLabel('Rally').locator('option')).toHaveText('recovery 1 · Jev fixture · right');
  await expect(page.locator('body')).toHaveAttribute('data-benchmark-stage', 'finished', { timeout: 20_000 });
  await expect(status).toContainText(/Short drop · landed at x \d+, y \d+ · missed return/);
  await expect(page.locator('canvas')).toHaveAttribute('data-robots', '2');
  await page.getByRole('button', { name: 'Replay shot' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-benchmark-stage', 'deciding');
  await page.getByRole('button', { name: /Chaos POV/ }).click();
  await expect(page.locator('canvas')).toHaveAttribute('data-camera', 'right');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
