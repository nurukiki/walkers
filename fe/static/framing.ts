import type { View } from './api.ts';

interface Landmark {
  x: number;
  y: number;
  visibility?: number;
}

export type Framing = 'loading' | 'not-visible' | 'off-center' | 'too-close' | 'too-far' | 'ready' | 'unavailable';

export function canConfirmFraming(status: Framing, previewReady: boolean) {
  return previewReady && (status === 'ready' || status === 'unavailable');
}

export function judgeFraming(poses: Landmark[][], view: View): Framing {
  const pose = poses[0];
  const visible = (point: Landmark | undefined): point is Landmark =>
    Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 0) >= 0.55);
  const head = pose?.[0];
  if (!visible(head) || !pose) return 'not-visible';

  // Shoulder, hip and heel landmarks for each side of the body.
  const legs = [[11, 23, 29], [12, 24, 30]].map((indices) => indices.map((i) => pose[i]).filter(visible));
  const visibleLegs = legs.filter((side) => side.length === 3);
  if (visibleLegs.length < (view === 'front' ? 2 : 1)) return 'not-visible';
  const points = [head, ...visibleLegs.flat()];
  const height = Math.max(...visibleLegs.map((side) => side[2].y)) - head.y;
  if (head.y < 0.10 || height > 0.85 || visibleLegs.some((side) => side[2].y > 0.95)) return 'too-close';
  if (height < 0.48) return 'too-far';
  if (points.some((point) => point.x < 0.08 || point.x > 0.92) || head.x < 0.23 || head.x > 0.77) return 'off-center';
  return 'ready';
}

export function framingAdvice(status: Framing, view: View) {
  const orientation = view === 'front' ? '카메라를 정면으로 바라봐' : '카메라에 옆모습을 보여';
  switch (status) {
    case 'loading': return '카메라 구도를 확인하고 있어요.';
    case 'not-visible': return `${orientation} 주세요. 머리와 발이 모두 나오도록 카메라를 맞춰 주세요.`;
    case 'off-center': return '화면 중앙으로 이동해 주세요.';
    case 'too-close': return '카메라에서 조금 뒤로 물러나 주세요.';
    case 'too-far': return '카메라에 조금 더 가까이 서 주세요.';
    case 'ready': return '전신과 거리가 확인됐어요. 화면을 보고 촬영 구도를 확인해 주세요.';
    case 'unavailable': return `자동 확인을 사용할 수 없어요. ${orientation} 주세요. 머리와 발이 모두 보이는지 미리보기에서 직접 확인해 주세요.`;
  }
}
