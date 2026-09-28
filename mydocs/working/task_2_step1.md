# Task 2: 구현 완료

- 기존 스킬에 판단 시점 호출 지침을 추가했다. 신규 스킬이나 실행 하네스는 생성하지 않았다.
- scripts/schedule.mjs 및 scripts/lib/schedule.mjs를 추가했다. PLAN·leaf Gate·ACCESS·dispatch·lease를 읽어 독립성, 순차 구간, 현재 실행 후보를 계산한다.
- 읽기/쓰기 집합과 비파일 공유 자원에 Bernstein 조건을 적용하며, 의존 경로가 있는 작업은 독립으로 인정하지 않는다.
- 상태를 변경하지 않고 다음 행동을 JSON으로 반환한다. 성공은 배정 조언이며 실제 실행·검증·종료의 성공으로 해석하지 않는다.
- 일반 반복에서는 대기 이유별 개수만 출력하고, 초기 계획·변경·문제 분석에서만 상세 구조를 출력한다.
- 기존 gate-check, dispatch-check, stop-hook 및 공용 구현 파일을 수정하지 않았다.

검증 및 한계는 task_2_final.md에 기록한다.
