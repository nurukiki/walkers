import { Global, css } from '@emotion/react';
import styled from '@emotion/styled';
import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

export type Tone = 'pink' | 'sage' | 'stone';
export type Art = 'intro' | 'devices' | 'standing' | 'walking' | 'motion' | 'outfit';
const colors = { pink: '#ffc6c7', sage: '#dbe6d7', stone: '#eeede8' };

const base = css`
  :root {
    font-family: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif;
    color: #22251f;
    background: #faf9f6;
    line-height: 1.5;
    font-synthesis: none;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 280px; }
  button, input, select { font: inherit; }
  button, a, select { -webkit-tap-highlight-color: transparent; }
  :focus-visible { outline: 3px solid #9d3152; outline-offset: 3px; }
`;

const Header = styled.header`
  background: #22251f;
  color: #f9f8f4;
`;
const HeaderInner = styled.div`
  max-width: 1440px;
  min-height: 72px;
  margin: auto;
  padding: 0 clamp(20px, 4.4vw, 64px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  strong { font: 400 clamp(26px, 3vw, 38px)/1 "Helvetica Neue", sans-serif; letter-spacing: -.06em; }
  span { font-size: .8rem; font-weight: 700; }
  @media (max-width: 620px) { min-height: 54px; }
`;
const Main = styled.main`
  max-width: 1440px;
  margin: auto;
  padding: clamp(20px, 2.4vw, 40px) clamp(20px, 4.4vw, 64px) 64px;
  h1 { margin: 0 0 4px; font-size: clamp(1.75rem, 3vw, 2.75rem); line-height: 1.2; letter-spacing: -.045em; word-break: keep-all; }
  > p { margin: 0 0 clamp(18px, 2vw, 30px); color: #535951; word-break: keep-all; }
`;
const Trail = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
  font-size: .82rem;
  font-weight: 700;
  color: #535951;
  ol { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; list-style: none; margin: 0; padding: 0; }
  li:not(:first-of-type)::before { content: "›"; margin-right: 10px; color: #737970; }
  li[aria-current] { color: #a0244d; }
  @media (max-width: 620px) { margin-bottom: 12px; font-size: .73rem; > span { display: none; } }
`;
const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1.19fr) minmax(0, 1fr);
  align-items: start;
  gap: clamp(20px, 3.6vw, 54px);
  @media (max-width: 760px) { grid-template-columns: minmax(0, 1fr); }
`;

const StageBox = styled.div<{ tone: Tone }>`
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  background: ${({ tone }) => colors[tone]};
  border-radius: 10px;
  overflow: hidden;
  aspect-ratio: 4 / 3;
  > svg, > img, > video, > canvas { grid-area: 1 / 1; display: block; }
  > svg, > img, > video { width: 100%; height: 100%; object-fit: contain; }
  > canvas { width: 100%; height: 100%; pointer-events: none; }
  > video { background: #22251f; }
  @media (max-width: 620px) { aspect-ratio: 16 / 10; }
`;
const Tag = styled.span`
  position: absolute;
  z-index: 1;
  top: clamp(8px, 1.5vw, 18px);
  left: clamp(8px, 1.5vw, 18px);
  border-radius: 4px;
  padding: 4px 10px;
  background: #faf9f4;
  color: #2c3029;
  font-size: .75rem;
  font-weight: 750;
`;
const Card = styled.section`
  min-width: 0;
  border-radius: 10px;
  padding: clamp(16px, 2vw, 26px);
  background: #fff;
  h2 { margin: 0 0 16px; padding-bottom: 12px; border-bottom: 1px solid #dedfd9; font-size: 1.2rem; line-height: 1.3; letter-spacing: -.03em; }
  p { margin: 0; color: #535951; word-break: keep-all; }
  dl { margin: 0; }
  dt { font-weight: 750; }
  dd { margin: 2px 0 14px; color: #535951; font-size: .9rem; word-break: keep-all; }
  dd:last-child { margin-bottom: 0; }
  form > label { display: block; font-weight: 700; }
`;
export const Buttons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
`;
const buttonCss = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: #22251f;
  color: #fff;
  font-size: .9rem;
  font-weight: 750;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
  &:hover { background: #373e35; }
  &[data-secondary] {
    background: #eeede8;
    color: #22251f;
    &:hover { background: #e2e1d9; }
  }
  &[aria-pressed="true"] { background: #ffc6c7; color: #22251f; border-color: #8b4b50; }
  &:disabled { background: #efeee9; color: #666b63; cursor: not-allowed; }
`;
export const Button = styled.button(buttonCss);
export const Link = styled.a(buttonCss);
export const Detail = styled.div`
  & + & { margin-top: 14px; }
  strong { display: block; }
  small { color: #535951; }
`;
export const Notice = styled.div`
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 5px;
  background: #f9e7e6;
  color: #85283d;
  font-size: .88rem;
  overflow-wrap: anywhere;
`;
export const Code = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 12px;
  span { display: grid; place-items: center; width: clamp(27px, 6vw, 42px); height: 44px; background: #eeede8; border-radius: 4px; font-size: 1.2rem; font-weight: 800; }
`;
export const Input = styled.input`
  max-width: 100%;
  width: 20rem;
  display: block;
  border: 1px solid #a6aca2;
  border-radius: 5px;
  background: #faf9f6;
  color: inherit;
  padding: 9px 12px;
  margin: 6px 0 12px;
  letter-spacing: .2em;
  font-weight: 700;
`;
export const Select = styled.select`
  width: 100%;
  margin-top: 6px;
  padding: 9px 12px;
  border: 1px solid #a6aca2;
  border-radius: 5px;
  background: #faf9f6;
  color: inherit;
`;
export const Metrics = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 155px), 1fr));
  gap: 8px;
  margin-top: 12px;
`;
export const MetricTile = styled.button`
  font: inherit;
  border: 1px solid #d6dcd2;
  border-radius: 5px;
  padding: 12px;
  color: inherit;
  background: #f9f9f6;
  text-align: left;
  overflow-wrap: anywhere;
  &:first-of-type { grid-column: 1 / -1; }
  &:not(:disabled) { cursor: pointer; }
  &[aria-pressed="true"] { background: #dbe6d7; border-color: #6f7e69; }
  strong, small { display: block; }
  span { font-size: .93rem; }
`;

function Illustration({ kind }: { kind: Art }) {
  const frame = ['standing', 'walking', 'motion', 'outfit'].includes(kind);
  const walker = ['intro', 'walking', 'motion'].includes(kind);
  return (
    <svg viewBox="0 0 640 480" aria-hidden="true">
      {frame && <g fill="none" stroke="#667c66" strokeWidth="2.5">
        <path d="M62 142v-32h32m452 0h32v32M62 398v32h32m452 0h32v-32" />
        <path d="M100 397h440" opacity=".36" />
      </g>}
      {kind === 'intro' && <g fill="none" stroke="#b86c74" opacity=".6" strokeWidth="2">
        <path d="M-15 455C218 415 257 159 660 106M-15 474C229 432 267 173 660 126M-15 493C238 450 280 188 660 147" />
        <circle cx="320" cy="254" r="146" strokeDasharray="6 8" />
      </g>}
      {walker && <g fill="#414d44" stroke="#414d44" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="318" cy="162" r="23" />
        <path d="M316 198l-21 81" strokeWidth="34" />
        <path d="M310 210l-38 38-30 23m68-57 37 29 37-24M298 273l-41 63-40 47m81-110 38 70 45 40" fill="none" strokeWidth="18" />
        {kind === 'motion' && <path d="M240 271l32-23 38-38 37 33 37-24m-74-9-12 63-41 63-40 47m81-110 38 70 45 40" fill="none" stroke="#ffaeb0" strokeWidth="4" />}
      </g>}
      {kind === 'standing' && <g fill="#414d44">
        <circle cx="320" cy="164" r="23" />
        <path d="M294 194h52l18 87-14 4-16-57 8 55h-44l8-55-16 57-14-4zm4 97h44l12 98h-22l-12-84-12 84h-22z" />
      </g>}
      {kind === 'devices' && <g stroke="#364139" strokeLinejoin="round" strokeLinecap="round" strokeWidth="6">
        <rect x="152" y="144" width="260" height="169" rx="10" fill="#faf9f6" />
        <path d="M282 313v30m-43 0h86" fill="none" />
        {[199, 229, 259, 289].map((x) => <circle key={x} cx={x} cy="227" r="6" fill="#61755e" stroke="none" />)}
        <rect x="350" y="224" width="101" height="158" rx="12" fill="#ffc6c7" />
        <path d="M384 242h30m-36 69 16 17 31-36" fill="none" />
      </g>}
      {kind === 'outfit' && <g fill="#f7f2e8" stroke="#49564c" strokeWidth="4" strokeLinejoin="round">
        <path d="M288 131c15 15 49 15 64 0l26 10 29 45-25 21-21-22v86h-82v-86l-21 22-25-21 29-45z" />
        <path d="M280 286h80l7 103h-35l-12-78-12 78h-35z" fill="#414b4b" />
      </g>}
    </svg>
  );
}

interface LayoutProps {
  role?: string;
  step: number;
  phase: string;
  title: string;
  subtitle: string;
  panel: string;
  tone: Tone;
  art: Art;
  tag: string;
  stage?: ReactNode;
  beneath?: ReactNode;
  children?: ReactNode;
}

export function Layout({ role = '공통', step, phase, title, subtitle, panel, tone, art, tag, stage, beneath, children }: LayoutProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title]);
  return <>
    <Global styles={base} />
    <Header><HeaderInner><strong>Walkers</strong><span>{role}</span></HeaderInner></Header>
    <Main>
      <Trail>
        <nav aria-label="체험 단계">
          <ol>{['기기 연결', '카메라 설정', '워킹 촬영', '결과 확인'].map((label, index) =>
            <li key={label} aria-current={step === index ? 'step' : undefined}>{label}</li>)}</ol>
        </nav>
        <span>{phase}</span>
      </Trail>
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
      <p>{subtitle}</p>
      <Grid>
        <div>
          <StageBox tone={tone}><Tag>{tag}</Tag>{stage || <Illustration kind={art} />}</StageBox>
          {beneath}
        </div>
        <Card aria-label={panel}><h2>{panel}</h2>{children}</Card>
      </Grid>
    </Main>
  </>;
}

export function LivePreview({ stream, videoRef, label }: { stream: MediaStream; videoRef: RefObject<HTMLVideoElement | null>; label: string }) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    return () => { video.srcObject = null; };
  }, [stream, videoRef]);
  return <video ref={videoRef} aria-label={label} autoPlay playsInline muted />;
}
