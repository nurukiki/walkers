# Walkers 프론트엔드

- `templates/index.html`: HTML 진입점
- `static/`: React, TypeScript, Emotion UI와 API·카메라·기기 연결 코드

## 실행

Node.js 22.13 이상을 사용합니다.

```sh
cd fe
npm ci
WALKERS_BACKEND_URL=http://127.0.0.1:8000 npm run dev
```

개발 서버의 `/`는 `/templates/index.html`로 이동합니다. `WALKERS_BACKEND_URL`을 설정하면 Vite가 명세서의 HTTP API와 WebSocket을 FastAPI로 프록시합니다. 미설정 상태에서도 첫 화면은 볼 수 있지만 체험에는 백엔드가 필요합니다. 실제 두 기기로 카메라를 쓰려면 두 브라우저에서 접근할 수 있는 **HTTPS** 주소를 사용하세요. `localhost`는 한 기기에서 테스트할 때만 사용할 수 있습니다.

`npm test`로 API·녹화·구도 확인 테스트를 실행하고, `npm run build`로 `dist/templates/index.html` 및 `dist/static/`을 생성합니다. 운영 환경에서는 템플릿을 `/`에서 제공하고 빌드된 정적 파일은 `/static/`에 마운트합니다. API와 WebSocket도 같은 오리진으로 제공하세요. Google 로그인 시작은 `/auth/google`로 이동하며, 콜백 처리·세션 발급·프론트 복귀는 백엔드가 담당합니다.

정면·측면 구도는 브라우저의 MediaPipe Pose Landmarker로 전신 위치와 화면 내 크기를 먼저 확인한 뒤 사용자가 미리보기에서 확인합니다. 모델을 불러오지 못하면 정상적인 실시간 미리보기를 보고 수동으로 확인할 수 있습니다. 자동 검사에서는 촬영 요청 응답 뒤 실제 녹화 직전의 정면 구도도 다시 검사합니다. 구도 검사는 영상 프레임을 서버에 보내지 않으며, 음성 안내는 기기의 한국어 TTS 지원에 따라 동작합니다. 모델과 WASM은 기본적으로 Google Storage·jsDelivr에서 불러옵니다. 자동 검사를 자체 호스팅하려면 모델 파일과 `@mediapipe/tasks-vision@0.10.32`의 `wasm/`을 호스팅하고 `VITE_WALKERS_POSE_MODEL_URL`(모델 파일)과 `VITE_WALKERS_POSE_WASM_URL`(WASM 디렉터리)을 지정하세요.

## 백엔드 연동 시 확인할 사항

Notion 표에 명시된 경로, 메서드, 요청 필드를 사용합니다. 표에 없는 응답 본문과 WebSocket 메시지 형식은 `static/api.ts`의 타입이 **임시 계약**입니다. 실제 FastAPI 응답과 맞춰야 합니다.

- 진입 화면은 기능 명세를 우선해 **Google 로그인과 연결 코드 입력을 한 화면**에 제공합니다. Notion API 표의 [`POST /device-pairings`](https://app.notion.com/41faa877e8588064a04cd5ba8748602e) 호출자 정정 문구: **“서브 기기 (Google 로그인 불필요, 유효한 `pairing_code` 필수)”**. 백엔드는 코드를 검증하고 해당 체험에만 유효한 기기 권한을 부여해야 합니다. 세션과 기기 권한은 같은 오리진 쿠키를 가정합니다. 생성·참여 응답은 `experience_id`, `pairing_code`(생성), `device_id`(참여), 촬영 시작 응답은 `recording_id`를 가정합니다.
- 서버는 메인의 `camera_status_request`, `recording_start`, `recording_stop`, `recording_cancel`을 서브에, 서브의 `camera_ready`, `camera_closed`, `recording_started`, `recording_failed`, `video_uploaded`, `video_upload_failed`를 메인에 전달해야 합니다. `recording_*`과 `video_*`에는 해당 `recording_id`를 포함하고, 서브가 보내는 응답에는 `camera_view: "side"`를 포함합니다. 녹화 ID 자료형은 HTTP 응답과 이벤트에서 같아야 합니다. 서버의 `device_disconnected`, `experience_ended`도 전달해 주세요.
- 정상 촬영은 두 영상의 업로드 확인 이후 `/stop`으로 종료합니다. 실패·취소 시에도 같은 `/stop`으로 이전 촬영을 정리하므로, 서버는 **영상이 없는 촬영도 종료하고 새 촬영을 허용**해야 합니다. 재연결·응답 유실에 대비해 `/stop` 반복과 촬영 ID + 카메라 시점이 같은 영상 재전송을 안전하게 처리해야 합니다. 취소된 촬영에는 분석을 요청하지 않습니다.
- 정상 종료 직후 워킹 분석을 요청하고 `status`를 폴링합니다. 워킹·패션의 요청/상태/결과 HTTP 호출은 각각 10초로 제한합니다. 화면에서 나가면 클라이언트의 요청을 중단하며, 서버의 분석 작업 자체를 취소하지는 않습니다. 받은 분석 ID가 있으면 재요청 없이 이어서 조회합니다. 최초 응답이 유실된 경우에도 중복 작업이 생기지 않도록 서버는 같은 영상 또는 같은 착장·스타일 조합의 진행 중 요청을 기존 작업에 연결하는 것을 권장합니다. 재생 URL은 `{ url }`, 타임라인의 관절 좌표는 `0..1` 범위의 `{ x, y }`를 가정합니다. 패션 사진 품질 응답은 `{ passed, message? }`를 가정합니다.

## 두 기기에서 확인할 회귀 시나리오

1. 서브 카메라만 켠 상태에서는 메인의 시작 버튼이 활성화되지 않아야 합니다. 양쪽 구도를 확인한 뒤 촬영합니다.
2. 시작 직전에 서브 연결이 끊기면 메인이 촬영 중으로 표시되지 않아야 합니다. 재연결하고 구도를 다시 확인한 뒤 새 촬영을 시작합니다.
3. 촬영 중 카메라가 끊기면 재촬영으로 돌아가야 합니다. 카메라는 정상이고 영상 전송만 실패한 경우에는 재녹화 없이 전송을 다시 시도할 수 있어야 합니다.
4. 두 영상이 정상 전송되면 결과 버튼을 누르지 않아도 워킹 분석 요청이 한 번 발생해야 합니다.
5. 분석 요청·상태 조회·결과 조회를 각각 지연시키면 시간 초과 후 재시도할 수 있어야 합니다. 대기 중 ‘분석 화면에서 나가기’를 누르면 진행 중인 HTTP 요청이 중단되고 결과 선택으로 돌아가야 합니다.
6. 모델/WASM 로딩에 실패해도 양쪽에서 실시간 미리보기로 직접 구도를 확인할 수 있어야 합니다. 자동 확인이 정상 작동할 때 `/recordings` 응답을 지연시키고 응답 직전에 정면 구도를 벗어나면, 양쪽 녹화가 시작되지 않고 이전 촬영 요청이 정리되어야 합니다.
