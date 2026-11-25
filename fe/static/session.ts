import { useCallback, useEffect, useRef, useState } from 'react';
import { socketUrl } from './api.ts';
import type { DeviceEvent, Id } from './api.ts';

export function useDeviceSocket(id: Id | undefined, onMessage: (event: DeviceEvent) => void) {
  const socket = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  const [state, setState] = useState<'connecting' | 'open' | 'closed'>('closed');
  useEffect(() => { handler.current = onMessage; }, [onMessage]);
  useEffect(() => {
    if (id === undefined) {
      setState('closed');
      return;
    }
    let disposed = false;
    let retry: ReturnType<typeof setTimeout>;
    let connection: WebSocket;
    function connect() {
      if (disposed || id === undefined) return;
      setState('connecting');
      connection = new WebSocket(socketUrl(id));
      socket.current = connection;
      connection.onopen = () => {
        if (!disposed) setState('open');
      };
      connection.onmessage = ({ data }) => {
        if (disposed || typeof data !== 'string') return;
        let message: DeviceEvent;
        try { message = JSON.parse(data); } catch { return; }
        if (message && typeof message.type === 'string') handler.current(message);
      };
      connection.onclose = () => {
        if (disposed) return;
        socket.current = null;
        setState('closed');
        retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current = null;
      connection.close();
    };
  }, [id]);

  const send = useCallback((event: DeviceEvent) => {
    if (socket.current?.readyState !== WebSocket.OPEN) return false;
    try {
      socket.current.send(JSON.stringify(event));
      return true;
    } catch { return false; }
  }, []);
  return { state, send };
}

export function useAction() {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : '작업을 완료하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
