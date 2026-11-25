import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, pairingCode } from './api.ts';
import type { Pairing } from './api.ts';
import { MainDevice } from './main-device.tsx';
import { SideDevice } from './side-device.tsx';
import { Button, Buttons, Detail, Input, Layout, Link, Notice } from './layout.tsx';
import { useAction } from './session.ts';

const resumeKey = 'walkers.resume-main';

function hasMainRole() {
  try { return sessionStorage.getItem(resumeKey) === '1'; }
  catch { return false; }
}

function App() {
  const [main, setMain] = useState(hasMainRole);
  const [pairing, setPairing] = useState<Pairing>();
  const [code, setCode] = useState('');
  const join = useAction();

  useEffect(() => {
    try { sessionStorage.removeItem(resumeKey); }
    catch { /* The app can still run without storage. */ }
  }, []);

  function resumeAfterLogin() {
    try {
      sessionStorage.setItem(resumeKey, '1');
    } catch { /* Users can choose the main role again after login. */ }
  }

  if (main) return <MainDevice onBack={() => setMain(false)} onLogin={resumeAfterLogin} />;
  if (pairing) return <SideDevice pairing={pairing} onBack={() => { setPairing(undefined); setCode(''); }} />;
  return <Layout step={0} phase="Walkers" title="어떤 기기로 시작할까요?"
    subtitle="메인 기기는 정면을, 연결 코드로 참여한 기기는 옆모습을 촬영해요."
    panel="로그인 또는 연결 코드로 시작" tone="pink" art="intro" tag="정면 · 측면 워킹 촬영">
    <Detail><strong>메인 기기</strong><small>Google 계정으로 로그인하면 새 체험을 시작할 수 있어요.</small></Detail>
    <Buttons style={{ marginBottom: 22 }}>
      {!join.busy && <Link href={api.login} onClick={resumeAfterLogin}>Google로 계속하기</Link>}
      <Button data-secondary disabled={join.busy} onClick={() => setMain(true)}>이미 로그인했어요</Button>
    </Buttons>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (code.length !== 6) return;
      void join.run(async () => {
        try { setPairing(await api.join(code)); }
        catch (err) {
          if (err instanceof ApiError && [401, 403].includes(err.status)) {
            throw new Error('서브 기기 참여가 거부됐어요. 연결 코드와 참여 권한을 확인해 주세요.');
          }
          throw err;
        }
      });
    }}>
      <label htmlFor="pairing-code">서브 기기 연결 코드</label>
      <p id="pairing-hint">별도 로그인 없이 메인 화면의 영문·숫자 6자리로 참여해요.</p>
      <Input id="pairing-code" aria-describedby="pairing-hint" autoCapitalize="characters" spellCheck={false} autoComplete="off"
        value={code} onChange={(event) => setCode(pairingCode(event.target.value))} />
      <Buttons><Button type="submit" data-secondary disabled={code.length !== 6 || join.busy}>{join.busy ? '연결 중…' : '연결 코드로 참여'}</Button></Buttons>
      {join.error && <Notice role="alert">{join.error}</Notice>}
    </form>
  </Layout>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Walkers root element is missing.');
createRoot(root).render(<App />);
