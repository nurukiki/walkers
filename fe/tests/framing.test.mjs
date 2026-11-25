import assert from 'node:assert/strict';
import test from 'node:test';
import { canConfirmFraming, judgeFraming } from '../static/framing.ts';

test('manual framing confirmation is only available with a live preview and no automatic check', () => {
  assert.equal(canConfirmFraming('unavailable', true), true);
  assert.equal(canConfirmFraming('unavailable', false), false);
  assert.equal(canConfirmFraming('ready', true), true);
  assert.equal(canConfirmFraming('not-visible', true), false);
  assert.equal(canConfirmFraming('loading', true), false);
});

function pose({ x = 0.5, head = 0.2, heels = 0.85 } = {}) {
  const p = [];
  for (const [i, y] of [[0, head], [11, 0.32], [12, 0.32], [23, 0.55], [24, 0.55], [29, heels], [30, heels]]) {
    p[i] = { x, y, visibility: 0.95 };
  }
  return p;
}

test('ready requires a visible full body centered at an appropriate scale', () => {
  assert.equal(judgeFraming([pose()], 'front'), 'ready');
  assert.equal(judgeFraming([], 'front'), 'not-visible');
  assert.equal(judgeFraming([pose({ x: 0.14 })], 'front'), 'off-center');
  assert.equal(judgeFraming([pose({ heels: 0.63 })], 'front'), 'too-far');
  assert.equal(judgeFraming([pose({ head: 0.05 })], 'front'), 'too-close');
});

test('side framing allows self-occlusion but not both feet out of view', () => {
  const p = pose();
  p[30].visibility = 0.25;
  assert.equal(judgeFraming([p], 'front'), 'not-visible');
  assert.equal(judgeFraming([p], 'side'), 'ready');
  p[29].visibility = 0;
  assert.equal(judgeFraming([p], 'side'), 'not-visible');
});
