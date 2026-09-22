# 업무 복잡도·분해 깊이·계산 자원 배분 문헌 조사

조사일: 2026-09-22

## 조사 범위와 결론

unlazy에 바로 새 규칙을 구현하기 전, 조직행동·직무설계·인간공학·병렬계산·메타추론 분야의 기존 이론과 수식을 조사했다. 저자 공개 논문, 대학 저장소, 출판사 및 학회 자료를 우선했다. 체계적 문헌고찰이나 메타분석을 수행한 것은 아니다.

핵심 결론: 업무 복잡도를 추상화하는 기존 연구는 충분하다. 그러나 복잡도 측정, 분해 깊이 선택, 병렬화, 추가 검토 중단은 서로 다른 문제다. 하나의 점수로 모두 결정하는 보편적으로 검증된 공식을 이번 조사에서 확보하지는 못했다.

깊이도 구분해야 한다. 목표를 세분화한 트리의 깊이는 분석자가 정한 표현 수준에 영향을 받는다. 반면 선행 작업을 기다려야 하는 의존 그래프의 깊이는 순차 제약을 나타낸다. 둘을 같은 변수로 취급하면 과도하게 세분화한 작업을 더 어렵다고 오판할 수 있다. 이는 아래 연구들을 비교한 해석이다.

## 1. Wood (1986): 업무 자체의 복잡도를 수치화

Robert E. Wood, Task complexity: Definition of the construct, Organizational Behavior and Human Decision Processes 37(1), 60–82. DOI: 10.1016/0749-5978(86)90044-0.

업무를 산출물, 필요한 행위, 정보 단서로 기술하고 구성·조정·동적 복잡도로 구분한다. 원문 Eq. (1), (2)를 인덱스가 명확하도록 표기하면 다음과 같다.

\[
C_{component}=\sum_j\sum_{i=1}^{n_j}W_{ij},\qquad
C_{coordination}=\sum_i r_i
\]

W는 해당 행위에서 처리할 정보 단서 수, r은 행위 사이 선행관계 수다. 조정 복잡도의 두 번째 식은 순서 관계를 포착하는 지수이며 타이밍·강도 등 전체 조정 요구를 완전히 대변하지 않는다. 동적 복잡도는 구성과 관계의 시간적 변화로 다루며, 변화의 예측 가능성도 논의한다.

동일 행위의 반복과 서로 다른 행위를 구분한다는 점이 중요하다. 데이터가 많다는 이유만으로 구조적 복잡도가 높아지는 것은 아니다. 다만 반복량은 실행 비용에 영향을 줄 수 있다.

근거 수준: 이론적 구성과 계산 예시. 논문은 지표의 판별·예측 타당성 검증이 필요하다고 명시한다. 보편적인 학습 완료 가중치나 AI 토큰 예측식은 아니다.

[저자 공개 원문](https://www.researchgate.net/publication/222383252_Task_complexity_Definition_of_the_construct)

## 2. HTA: 어디까지 분해할 것인가

Neville A. Stanton (2006), Hierarchical task analysis: Developments, applications, and extensions, Applied Ergonomics 37(1), 55–79. DOI: 10.1016/j.apergo.2005.06.003. Annett와 동료들의 기존 접근을 정리한 논문이다.

목표를 하위 목표와 실행 계획으로 분해한다. 전통적인 P×C 중단 규칙을 임계값 표기로 표현하면 다음과 같다. tau는 설명을 위해 도입한 허용 기준 기호다.

\[
P(\text{실패})\times C(\text{실패})\le\tau
\quad\Rightarrow\quad \text{추가 상세 분석 중단}
\]

이는 업무를 미완료로 종료한다는 뜻이 아니라, 하위 목표를 더 자세히 기술하는 분석을 멈춘다는 뜻이다. 모든 가지를 같은 깊이로 분해할 필요가 없다.

근거 수준: 오래 사용된 인간공학 방법의 검토. 저자는 실제 확률과 비용을 알기 어렵고, 이 규칙은 거친 휴리스틱이라는 문제도 설명한다. 분석 깊이가 깊어지면 위험이 자동으로 감소한다는 보장은 없다.

[저자 대학 저장소](https://eprints.soton.ac.uk/73988/) · [원문 본문](https://www.researchgate.net/publication/7622539_Hierarchical_task_analysis_Developments_applications_and_extensions)

## 3. DSM·WTM: 나눴을 때 발생하는 의존관계와 재작업

Eppinger, Whitney, Smith & Gebala (1994), A Model-Based Method for Organizing Tasks in Product Development, Research in Engineering Design 6, 1–13. DOI: 10.1007/BF01588087.

업무 사이에 필요한 정보 전달을 행렬로 표현해 작업 순서와 경계를 검토한다. 단순히 하위 작업 수를 늘리는 것보다, 서로 정보를 주고받아야 하는 작업이 어디에 모여 있는지 파악하는 데 적합하다.

[저자 공개 논문](https://stuff.mit.edu/people/eppinger/pdf/Eppinger_RED1994.pdf)

Smith & Eppinger (1997), Identifying Controlling Features of Engineering Design Iteration, Management Science 43(3), 276–293. DOI: 10.1287/mnsc.43.3.276.

WTM은 DSM을 확장해 결합된 작업 사이 반복 수정의 수렴을 모델링한다. 자동차 브레이크 시스템 개발 사례에 적용했다. 실제 작업의 관계 강도와 모델 가정이 필요하므로, 의존관계가 있다는 표시만으로 정확한 재작업 비용을 산출하는 것은 아니다. 이번 조사에서는 이 논문의 출판사 초록과 서지를 확인했으며, 상세 수식은 검증 없이 옮기지 않았다.

[출판사 논문](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.43.3.276)

unlazy 적용 해석: 구조를 나눌 때 왕복 수정이 많은 부분은 한 담당자에게 묶는 방안을 평가할 수 있다. 분해 자체와 다중 에이전트 배치는 별개 결정이다.

## 4. 병렬계산의 work–span: 총량과 순차 깊이 분리

Blumofe & Leiserson (1999), Scheduling Multithreaded Computations by Work Stealing, Journal of the ACM 46(5), 720–748. DOI: 10.1145/324133.324234.

W를 전체 작업량, S를 최장 의존 경로의 작업량, p를 처리자 수라고 하면 통상적인 작업 그래프 모형의 하한은 다음과 같다.

\[
T_p\ge\max(W/p,S),\qquad \text{평균 병렬성}=W/S
\]

논문은 fully strict 구조 등 명시된 조건에서 work-stealing 기대 실행 시간을 T1/p + O(T∞)로 분석한다. W/S가 작으면 많은 처리자를 투입해도 순차 경로 때문에 속도 향상이 제한된다.

근거 수준: 조건부 수학적 보장. LLM 분업의 토큰 절감 보장은 아니다. 에이전트는 브리핑·대화·재검증으로 총 작업량 W 자체를 늘릴 수 있다.

[공개 논문](https://www.cs.utexas.edu/~venkatar/sys_perf_analysis/ws_theory.pdf)

## 5. 메타추론·BMPS: 판단 수식 자체를 저렴하게 만들기

Russell & Wefald (1991)의 rational metareasoning 계열은 계산을 더 할지 여부를 그 계산의 기대 효용과 비용으로 결정한다.

[저자의 연구 설명](https://people.eecs.berkeley.edu/~russell/research-bo.html)

Callaway, Gul, Krueger, Griffiths & Lieder (2018), Learning to select computations, UAI 2018, 776–785.

최적 계산 선택을 정확히 푸는 비용이 크므로 BMPS는 다음 근사식을 사용한다. 원문 Eq. (5).

\[
\widehat{VOC}(c,b;w)=w_1VOI_1(c,b)+w_2VPI(b)
+w_3VPI_{sub}(c,b)-w_4cost(c)
\]

- c: 후보 계산, b: 현재 정보·믿음 상태.
- VOI1: 한 번의 추가 계산으로 얻는 정보의 기대 가치.
- VPI: 완전한 정보를 얻을 때의 기대 가치.
- VPIsub: 관련된 일부 정보만 완전히 알 때의 기대 가치.
- cost: 계산 비용.

앞의 세 가중치는 0~1이며 합이 1이다. 가중치는 베이지안 최적화로 학습한다. 세 가지 메타추론 문제와 재난 대응 예제로 평가했다. 논문은 메타추론의 부가 비용도 고려한다.

근거 수준: 형식적 모델과 실험. LLM 업무의 정보가치·확률을 자동으로 정확하게 제공하지는 않는다. 바로 다음 한 단계만 이득이 없다고 중단하면, 여러 단계를 함께 해야 효과가 생기는 경우를 놓칠 수 있다는 점도 논의한다.

[논문 원문](https://cocosci.princeton.edu/papers/callawayLearningToSelect.pdf) · [UAI 출판 정보](https://collaborate.princeton.edu/en/publications/learning-to-select-computations/)

## 6. HR의 검증된 측정 도구와 숙련도 변수

Morgeson & Humphrey (2006), The Work Design Questionnaire (WDQ): Developing and validating a comprehensive measure for assessing job design and the nature of work, Journal of Applied Psychology 91, 1321–1339.

21개 직무 특성을 과업·지식·사회·맥락 범주로 구분한다. 직무 복잡도, 정보 처리, 문제 해결 등을 구별해 측정한다. 1~5 동의 척도를 사용한다. 사람의 직무 특성 측정에는 검증 근거가 있지만, 이를 짧은 AI 작업 점수로 옮기면 재검증이 필요하다. 단일 총점만으로 분해 깊이를 결정하는 도구는 아니다.

[저자 공식 자료와 설문](https://www.morgeson.com/wdq.html)

Bonner (1994), A model of the effects of audit task complexity, Accounting, Organizations and Society 19(3), 213–234. DOI: 10.1016/0361-3682(94)90033-7.

과업 복잡성과 수행자의 기술 수준을 함께 다룬다. 기존 감사 판단 연구의 재분석에서 복잡도/숙련도와 성과의 관계를 검토하며, 일부 결과는 숙련도의 영향이 크다. AI 적용 시 같은 업무라도 모델·도구·경험 맥락에 따라 실패확률이 달라진다는 가설의 근거가 된다. 사람의 결과를 AI에 대한 검증 결과로 간주해서는 안 된다.

[저자 대학 공개 논문](https://msbfile03.usc.edu/digitalmeasures/sbonner/intellcont/Bonner1994-1.pdf)

직급 수준을 시간 범위로 측정하는 Jaques 계열도 발견했다. The Jaquesian level-of-work estimators: A systematic formulation (1974)은 한 기업의 29개 역할 사례를 보고한다. 직무·관리 역할의 시간 범위와 짧은 AI 작업의 실행 시간을 동일시하기 어려워 핵심 후보에서는 제외했다.

[출판사 초록](https://www.sciencedirect.com/science/article/pii/0030507374900221)

## 7. 최근 AI 에이전트 실증과 일반화 한계

Kim et al., Towards a Science of Scaling Agent Systems, arXiv:2512.08296v3, 2026-04-08 개정본.

6개 벤치마크, 5개 구조, 3개 모델 계열의 260개 구성을 분석했다. 복잡도만이 아니라 단일 에이전트 기본 성능과 조정 비용의 상호작용을 고려한다. 최신 본문 보고값은 교차검증 R²=0.373, 과업 기반 능력 지표 사용 시 0.413이다. 새로운 도메인의 절대 성능을 예측하는 한계도 명시한다.

근거 수준: 공개 프리프린트의 저자 보고 결과. 이번 조사에서 재현하지 않았다. 원문의 구버전과 최신판 수치가 달라 최신판을 기준으로 기록했다. 일부 변수는 실행 기록을 통해 구하므로 새 작업 설명만 읽고 즉시 정확한 예측을 할 수 있다는 근거는 아니다. 논문의 수치 임계값을 unlazy 기본 설정으로 그대로 가져오기는 어렵다.

[최신 확인 본문 v3](https://arxiv.org/html/2512.08296v3)

## 조사로부터 도출한 적용 방향

아래는 논문의 단일 처방이 아니라 조사자의 종합 판단이다.

1. Wood와 WDQ를 참고해 무엇이 복잡한지 구별한다. 행위·단서 수, 의존관계, 변화, 정보 처리·문제 해결 요구를 서로 분리한다.
2. HTA를 참고해 분해의 상세 수준을 정한다. 모든 가지에 같은 깊이를 강제하지 않는다.
3. DSM과 work–span으로 순차 제약·왕복 수정·병렬성을 평가한다. 작업이 어렵다는 이유만으로 병렬화하지 않는다.
4. 메타추론으로 추가 분석·분해·검토의 기대 가치와 비용을 비교한다. 필수 완료 조건을 삭제하는 근거로 사용하지 않는다.
5. 실제 AI 작업의 토큰, 시간, 완료율, 재작업을 기록해 확률과 가중치를 보정한다. 같은 원작업의 변형들이 학습·평가 양쪽에 섞이지 않게 분리한다.

아직 필요한 검증: 작업을 누가 분석해도 비슷하게 세는지, 미확인 정보를 어떻게 표기하는지, 관측 전 추정값과 실행 후 지표를 어떻게 분리하는지, 계획 비용까지 포함해 절감되는지, 모델·도구 변경 후 보정이 유지되는지.

우선 정독할 문헌은 HTA(분해 중단), Wood(복잡도 구성), BMPS(추가 사고 비용), DSM(분업 경계)다. 이번 단계에서는 설치된 스킬이나 작업 규칙을 수정하지 않았다.
