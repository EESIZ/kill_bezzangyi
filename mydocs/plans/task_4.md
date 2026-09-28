# Task 4 — 다음 논리 턴의 안전한 재분배

사용자가 실행 중 발견한 분할을 부모에게 보고하고 다음 턴에 검산·재분배하도록 승인했다. 기존 structure 테스트 34/34를 기준선으로 확인했다. 기존 Gate/dispatch/Stop hook 구현은 유지한다.

1. 다음 턴, 보고·정지 인계, 작업 보존과 멱등성의 계약을 수식으로 정의한다.
2. 영속적인 분할 보고와 부모의 수락/거절 이벤트를 기존 구조 트랜잭션에 추가한다.
3. 정확한 기존 실행 시도만 인계 완료로 구분하고 새 실행·스케줄링·최종 검산에 연결한다.
4. 중복, 중간 실패, 미정지, 남은 lease, 재실행, 반복 재분할과 독립 가지 진행을 검증한다.
5. 전체 회귀, 스킬 사용 지침 및 완료 보고를 마무리한다.

## 수식과 저장 계약

논리 턴 t는 성공적으로 반영한 고유 구조 이벤트의 수다. 같은 이벤트 재시도는 t를 증가시키지 않는다. 보고 q는 source=(wave, task, handle, startAt), 체크포인트, 완료/남은 Gate ID의 분할, 자식 후보를 보존한다.

수락 조건:

`Eligible(q,t) = pending(q) ∧ reportTurn(q)<t ∧ returned(source(q)) ∧ stoppedAttested(q) ∧ reviewed(q) ∧ noLease(task(q)) ∧ noOtherLiveAttempt(task(q)) ∧ checkpointMatches(q)`

여기서 returned는 호스트 dispatch의 정확한 반환 기록이다. stoppedAttested/reviewed는 부모가 근거를 기록한 명시적 확인이며 스크립트가 OS 프로세스 정지나 의미적 타당성을 증명한다는 뜻은 아니다.

`GateIDs(parent) = Completed(q) ⊎ Remaining(q)`를 검산한다. completed Gate에는 현재 met 증거가 필요하다. 원본 ledger와 텍스트 산출물 해시를 체크포인트에 보존한다. 부모의 전체 Gate 정의는 유지하고 재통합 전에 다시 검증한다. 체크포인트는 작업 파일을 되돌리거나 덮어쓰지 않는다.

기존 시도는 삭제하거나 VERIFIED로 위장하지 않는다. 수락된 보고에 source와 returnedAt을 묶어 해당 시도만 인계 완료로 분류한다. 같은 task의 새 wave/start는 새로운 실행이며 다시 active로 센다. 기존 wave의 다른 가지는 계속 실행 가능하다.

부모 p, 새 자식 집합 C에 대해 `V'=V∪C`, `Pred'(p)=Pred(p)∪C`, 각 자식은 기존 Pred(p)를 상속한다. 원래 부모가 이미 통합 작업이었어도 새로운 인계 보고로 추가 자식 집합을 붙일 수 있다. 기존 ID, 간선, Gate, 보고, 실행 이력을 삭제하지 않는다.

`T_e(T_e(S))=T_e(S)`와 `R=0` 검산을 report/accept/reject 모두에 적용한다. 다음 턴 수락 시 후보 검증 실패는 상태 변경 없이 거절한다. pending 보고는 최종 완료를 막는다. 명시적인 거절은 실행을 완료/정지한 것으로 처리하지 않는다.

미정지·미반환·남은 lease에서는 기존 작업의 활동 상태를 유지한다. accepted 시도만 활동 계산에서 제외하며 원래 작업은 자식 결과의 통합 책임으로 남는다. 기존 파일 잠금의 강제 종료 후 수동 정리 경계는 유지한다.

검토 중 추가한 복구 경로: 분할을 채택하지 않고 원래 작업을 이어가려면 resumeReports가 동일한 정지·반환·검토·lease 해제를 요구한 후 원래 작업을 다시 배정한다. 인계가 끝난 시도만 제외하며 자식은 생성하지 않는다. rejected는 실행 상태를 바꾸지 않는 단순 거절이다.
