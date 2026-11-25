import { useCallback, useEffect, useRef, useState } from 'react';

export function useCamera(view: 'front' | 'side') {
  const current = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const close = useCallback(() => {
    generation.current += 1;
    current.current?.getTracks().forEach((track) => track.stop());
    current.current = null;
    setStream(null);
  }, []);
  const open = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있어요.');
    }
    close();
    const version = generation.current;
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: view === 'front' ? 'user' : 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch {
      throw new Error('브라우저에서 카메라 접근을 허용했는지 확인해 주세요.');
    }
    if (generation.current !== version) {
      media.getTracks().forEach((track) => track.stop());
      throw new DOMException('카메라 요청을 취소했어요.', 'AbortError');
    }
    current.current = media;
    media.getVideoTracks().forEach((track) => track.addEventListener('ended', close, { once: true }));
    setStream(media);
    return media;
  }, [close, view]);
  useEffect(() => close, [close]);
  return { stream, open, close };
}

export function takePhoto(video: HTMLVideoElement | null) {
  if (!video?.videoWidth || !video.videoHeight) throw new Error('카메라 미리보기가 준비된 후 다시 시도해 주세요.');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('사진을 만들지 못했어요.');
  ctx.drawImage(video, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((photo) => photo ? resolve(photo) : reject(new Error('사진을 만들지 못했어요.')), 'image/jpeg', 0.9);
  });
}
