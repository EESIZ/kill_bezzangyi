# Task 8 단계 1 — 구현·회귀·C 동결

Task 7 이후 사용자의 동일 시험 비교 진행 지시에 따라 C 구현과 실행을 진행한다.

## 적용한 변경

- `verify-once.mjs`와 `lib/verification.mjs`: 명시적으로 닫힌 텍스트 입력/관련 환경/Gate 정의/수동 증거/검사기/계약 개정의 맥락을 기록한다. 부모 측 공식 검사에는 기존 gate-check의 승인과 --reverify를 사용하고 현재 증거만 재사용한다.
- 같은 반환/명령 재호출에서 입력이 같으면 공식 검사를 다시 실행하지 않는다. pending 기록 이후의 중단, 실패, 입력 변화는 통과로 추정하지 않는다. 원래 검사기가 쓰는 Gate 증거와 receipt가 모두 일치해야 한다.
- 수동 Gate가 있는 새 맥락은 실제 검토와 `--reviewed` 확인을 요구한다. checked box만으로 수동 검토를 재승인하지 않는다.
- scheduler/structure checker는 receipt를 사용한 VERIFIED leaf의 오래된 증거를 차단한다. 기존 supplied snapshot과 legacy scope는 기존 경로다.
- 스킬과 관련 참조에 부모 측 공식 검사, 필요할 때만 상세/소스 읽기, 실제 통합 검사를 연결했다. 새 branch 템플릿 N1은 child receipt를 감사한다. 원본 branch 템플릿은 legacy 용도로 보존한다.

## 구현하지 않은 부분

Task 7의 전체 `advance` 사건 실행기, native agent 자동 호출, OS writer-stop 자동 증명은 이번 C에 없다. 기존 호스트 조작·lease/dispatch/report 절차는 남는다. 닫힌 입력 범위는 작성자의 선언이며 완전성을 코드에서 추론하지 않는다. 재사용은 협력적 워크플로의 증거 관리이고 적대적 위조 방지가 아니다. 바이너리·외부 상태는 재사용 대상에서 제외한다. 입력 전후 지문만으로 임의 동시 ABA 변경을 검출한다고 주장하지 않는다.

## 검증

같은 동결 Linux 컨테이너, init 활성 환경에서 새 기능 14개를 포함한 전체 회귀 **282/282**를 통과했다. 초기 새 수동 검토 테스트의 fixture가 잘못된 EVIDENCE 줄을 바꾸는 문제를 수정한 뒤 최종 전체 회귀를 다시 수행했다. 최종 로그는 `work/skill-benchmark-c/regression-C.log`다.

기존 A/B 원자료/manifest와 스킬 사본의 해시를 대조했다. C 런타임 배포 파일 49개 동결 해시:

`e3b205eba990de25c6123dbb872e09dba2976ca61681c0b2f7e8c89babe5e519`

## 비교 조건

새 `work/skill-benchmark-c` 폴더에서 C만 실행한다. 전체 과제 16회, 판단 16회. 과제 프롬프트·채점기 해시는 기존 manifest와 실행 전에 일치 여부를 검사한다. image/model/reasoning/caps/telemetry는 이전과 같다. A/B와 시간대가 다른 후행 비교라는 한계를 결과표에 명시한다. 실행 도중 실패한 trial을 수정해서 대체하지 않는다. C 동결본과 모델 과제 산출물은 실행 후 결과 분석에서도 수정하지 않는다.
