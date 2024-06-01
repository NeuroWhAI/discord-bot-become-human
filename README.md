# Discord Bot Become Human

🚧 Work in progress 🚧

OpenAI 대화 모델을 적절히 사용하여 디스코드 채널에서 자연스럽게 사람들의 대화에 참여하는 봇.

**Multi-User Conversation**  
![demo](assets/demo.png)

**Reference message & Vision**  
![demo2](assets/demo2.png)

**Function Calls**  
![demo3](assets/demo3.png)

## Features

- [x] 정해진 채널에서 다자간 대화(텍스트, 이미지(첨부, 이모지, 스티커)) 수집.
- [x] 채널이 일정시간 이상 조용하거나 봇이 멘션되면 수집한 맥락을 가지고 대화 시작.
- [x] 대화 시작 이후에는 멘션이 없어도 일정시간 뒤 응답.
- [x] 응답을 할지 말지 판단.
- [x] 대화를 중지할지 말지 판단.
- [x] 대화 주제가 전환되었는지 판단.
- [x] 대화 중지 또는 주제 전환시 이전 대화를 내부적으로 요약.
- [x] 함수 호출 기능 사용하여 기능 확장.
  - [x] 현재 날씨 및 예보 조회. ([Weatherbit](https://www.weatherbit.io/))
  - [x] 인터넷 검색. ([Tavily AI](https://tavily.com/))
  - [x] 이미지 생성 및 수정. ([Stability AI](https://platform.stability.ai/))
  - [x] 코드 실행. ([Pyodide](https://pyodide.org/en/stable/))
  - [x] 이전 대화 검색. ([Chroma](https://www.trychroma.com/))
- [x] 이전 대화들을 정리하여 임베딩 계산 후 DB에 저장.
- [ ] 좀 더 똑똑하게 대화 참여 및 나가기.
