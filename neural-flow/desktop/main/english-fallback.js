// Gemini 키가 없을 때 쓰는 영어 회화 표현 21개 (날짜 기준으로 돌아가며 1개씩).
// 커리어(면접·커피챗·회의·협업) 상황 위주.

const E = (expression, meaning, situation, dialogue, variations, tip) => ({
  expression,
  meaning,
  situation,
  dialogue: dialogue.map(([speaker, en, ko]) => ({ speaker, en, ko })),
  variations,
  tip,
})

const ENGLISH_FALLBACK = [
  E('Let me walk you through it.', '제가 차근차근 설명드릴게요.', '발표·면접에서 프로젝트를 설명하기 시작할 때', [
    ['A', 'Can you tell us about the AdGuard project?', 'AdGuard 프로젝트에 대해 말씀해 주시겠어요?'],
    ['B', "Sure, let me walk you through it. It started with a simple question.", '네, 차근차근 설명드릴게요. 단순한 질문에서 시작했어요.'],
    ['A', "Great, I'd love to hear it.", '좋아요, 듣고 싶네요.'],
  ], ['Let me break it down for you.', "I'll take you through it step by step."], "'explain you' 는 틀린 표현. walk someone through 는 '단계별로 안내하다'."),
  E('That’s a fair point.', '일리 있는 말이에요.', '상대 의견을 인정하면서 대화를 이어갈 때', [
    ['A', 'Launching next week might be too early.', '다음 주 출시는 너무 이를 수도 있어요.'],
    ['B', "That's a fair point. What if we start with a beta?", '일리 있네요. 베타로 먼저 시작하면 어때요?'],
  ], ['Good point.', 'I see where you’re coming from.'], '반박 전에 먼저 인정하면 훨씬 부드럽다. 회의에서 가장 많이 쓰는 쿠션 표현.'),
  E("I'm on it.", '제가 바로 처리할게요.', '일을 맡았을 때 짧고 확실하게', [
    ['A', 'Could someone update the deck before 3?', '3시 전에 누가 자료 좀 업데이트해 줄래요?'],
    ['B', "I'm on it.", '제가 할게요.'],
    ['A', 'Thanks, appreciate it.', '고마워요.'],
  ], ["I'll take care of it.", 'Consider it done.'], '슬랙·메신저에서도 자주 쓴다. 자신감 있게 짧게.'),
  E('Just to make sure we’re on the same page…', '우리가 같은 이해를 하고 있는지 확인하자면…', '회의 끝에 합의 내용을 정리할 때', [
    ['A', "Just to make sure we're on the same page, the deadline is Friday?", '확인차 여쭤보면, 마감이 금요일 맞죠?'],
    ['B', 'Yes, Friday end of day.', '네, 금요일 업무 종료 시까지요.'],
  ], ['Let me recap what we agreed on.', 'Can I confirm one thing?'], '오해를 막는 가장 프로다운 문장. on the same page = 같은 이해.'),
  E('Could you elaborate on that?', '조금 더 자세히 말씀해 주실 수 있을까요?', '면접관 질문이 모호하거나 더 듣고 싶을 때', [
    ['A', 'How do you handle ambiguity?', '모호한 상황을 어떻게 다루나요?'],
    ['B', 'Could you elaborate on that? Do you mean unclear requirements?', '조금 더 설명해 주실 수 있나요? 요구사항이 불명확한 경우를 말씀하시나요?'],
  ], ['What do you mean by…?', 'Could you give me an example?'], "질문을 되묻는 건 약점이 아니다. 'elaborate' 발음은 [일-래-버-레잇]."),
  E("I'd love to pick your brain.", '조언을 좀 구하고 싶어요.', '커피챗·네트워킹에서 경험을 묻고 싶을 때', [
    ['A', "I'd love to pick your brain about moving into product.", 'PM으로 전향하는 것에 대해 조언을 구하고 싶어요.'],
    ['B', 'Happy to help. Coffee on Thursday?', '기꺼이요. 목요일에 커피 어때요?'],
  ], ['Could I get your take on…?', "I'd appreciate your insight on…"], '캐주얼하지만 공손한 요청. 콜드메일 첫 문장으로도 좋다.'),
  E('Let’s circle back to this.', '이건 나중에 다시 이야기해요.', '회의 주제에서 벗어나거나 결정이 어려울 때', [
    ['A', 'What about the pricing model?', '가격 모델은요?'],
    ['B', "Good question. Let's circle back to this after the demo.", '좋은 질문이에요. 데모 끝나고 다시 이야기해요.'],
  ], ["Let's park this for now.", "Let's revisit this later."], 'park 는 잠시 보류, circle back 은 반드시 돌아온다는 뉘앙스.'),
  E('That makes sense.', '그렇군요, 이해돼요.', '상대 설명을 이해했다고 반응할 때', [
    ['A', 'We cut the feature because users never found it.', '사용자들이 못 찾아서 그 기능을 뺐어요.'],
    ['B', 'That makes sense. Discovery was the real problem.', '이해돼요. 진짜 문제는 발견성이었네요.'],
  ], ['Got it.', 'I see.'], "'I understand' 보다 자연스럽다. 맞장구 뒤에 한 문장을 더 붙이면 대화가 산다."),
  E("I'm not sure, but I'll find out.", '확실하진 않지만 알아볼게요.', '모르는 질문을 받았을 때 솔직하고 프로답게', [
    ['A', 'What was the retention rate last quarter?', '지난 분기 리텐션이 몇이었죠?'],
    ['B', "I'm not sure, but I'll find out and get back to you today.", '확실하진 않은데 알아보고 오늘 중으로 알려드릴게요.'],
  ], ['Let me double-check and get back to you.', "I don't have that number handy."], '모르면 모른다고 + 언제까지 알려줄지. 신뢰를 만드는 공식.'),
  E('What I took away from it was…', '제가 거기서 얻은 교훈은…', "면접의 '그 경험에서 무엇을 배웠나요?'에 답할 때", [
    ['A', 'What did you learn from that failure?', '그 실패에서 뭘 배웠나요?'],
    ['B', 'What I took away from it was to test with real users earlier.', '실제 사용자와 더 일찍 테스트해야 한다는 걸 배웠어요.'],
  ], ['The key lesson for me was…', 'It taught me to…'], "'I learned that' 만 반복하지 말고 표현을 바꿔 주면 훨씬 유창하게 들린다."),
  E('Would it be possible to…?', '혹시 ~해 주실 수 있을까요?', '부담스러운 부탁을 정중하게 할 때', [
    ['A', 'Would it be possible to move our call to 4 p.m.?', '혹시 통화를 4시로 옮길 수 있을까요?'],
    ['B', 'Sure, 4 works for me.', '물론이죠, 4시 괜찮아요.'],
  ], ['Would you mind if…?', 'Is there any chance we could…?'], "'Can you' 보다 두 단계 정중하다. 이메일에서도 그대로 쓴다."),
  E('I hear you.', '무슨 말인지 알아요 (공감해요).', '상대의 불만·걱정에 먼저 공감할 때', [
    ['A', 'This sprint has been exhausting.', '이번 스프린트 너무 힘들었어요.'],
    ['B', "I hear you. Let's scope down next week.", '공감해요. 다음 주는 범위를 줄여요.'],
  ], ['I totally get it.', 'That sounds tough.'], "동의가 아니라 '듣고 있다'는 신호. CX 기획자에게 필수 표현."),
  E('Can we take this offline?', '이건 따로 이야기할까요?', '회의 중 일부 인원만 관련된 논의가 길어질 때', [
    ['A', 'About the API error logs—', 'API 에러 로그 말인데요—'],
    ['B', "Can we take this offline? Let's sync after the meeting.", '이건 따로 이야기할까요? 회의 끝나고 맞춰봐요.'],
  ], ["Let's discuss this separately.", "Let's sync one-on-one."], 'offline = 인터넷이 아니라 회의 밖에서.'),
  E("It's a work in progress.", '아직 진행 중이에요 (다듬는 중).', '미완성 작업을 보여주거나 겸손하게 소개할 때', [
    ['A', 'Is this your portfolio site?', '이게 포트폴리오 사이트예요?'],
    ['B', "Yes, it's a work in progress, but the case studies are up.", '네, 아직 다듬는 중이지만 사례 연구는 올라가 있어요.'],
  ], ['Still ironing out the details.', "It's still rough around the edges."], "'Not finished' 보다 긍정적이다."),
  E('Off the top of my head…', '지금 당장 떠오르는 건…', '준비 없이 즉석에서 답할 때', [
    ['A', 'Any ideas for the campaign name?', '캠페인 이름 아이디어 있어요?'],
    ['B', "Off the top of my head, maybe 'Next Move'?", "당장 떠오르는 건 'Next Move' 정도?"],
  ], ['Just thinking out loud…', 'My first instinct is…'], '즉흥 답변이라는 쿠션을 깔아 부담을 줄인다.'),
  E('I’m leaning towards…', '저는 ~쪽으로 마음이 기울어요.', '의견을 부드럽게 밝힐 때', [
    ['A', 'Option A or B?', 'A안이요, B안이요?'],
    ['B', "I'm leaning towards B. It's simpler for new users.", 'B안 쪽이에요. 신규 사용자에게 더 단순하거든요.'],
  ], ['I’d go with…', 'I’m inclined to…'], '단정하지 않으면서 입장을 밝히는 표현. 근거 한 문장을 꼭 붙이자.'),
  E('Thanks for having me.', '불러주셔서 감사합니다.', '면접·인터뷰·팟캐스트 시작할 때', [
    ['A', 'Welcome! Thanks for joining us today.', '환영해요! 오늘 와 주셔서 감사해요.'],
    ['B', "Thanks for having me. I'm excited to be here.", '불러주셔서 감사해요. 와서 설레네요.'],
  ], ['Thank you for the opportunity.', 'Great to be here.'], "'Thank you for inviting me' 보다 원어민스럽다."),
  E('Keep me posted.', '진행 상황 계속 알려주세요.', '상대가 진행할 일을 맡았을 때 마무리 인사', [
    ['A', "I'll hear back from the client tomorrow.", '내일 클라이언트 답을 받을 거예요.'],
    ['B', 'Great, keep me posted.', '좋아요, 계속 알려줘요.'],
  ], ['Let me know how it goes.', 'Keep me in the loop.'], 'in the loop = 정보 공유 대상에 포함된 상태.'),
  E("Let's play it by ear.", '상황 봐서 정해요.', '계획을 확정하지 않고 유연하게 가고 싶을 때', [
    ['A', 'Should we book dinner after the event?', '행사 끝나고 저녁 예약할까요?'],
    ['B', "Let's play it by ear. It might run late.", '상황 봐서 해요. 늦게 끝날 수도 있어서요.'],
  ], ['We’ll see how it goes.', "Let's keep it flexible."], '악보 없이 귀로 연주한다는 데서 나온 표현.'),
  E('Could you give me a ballpark?', '대략적인 수치를 알려줄 수 있어요?', '정확한 숫자 대신 대략적인 범위를 묻고 싶을 때', [
    ['A', 'How long will the MVP take?', 'MVP 얼마나 걸릴까요?'],
    ['B', 'Hard to say exactly.', '정확히 말하긴 어려워요.'],
    ['A', 'Could you give me a ballpark?', '대략이라도요?'],
  ], ['Roughly how much…?', 'A rough estimate is fine.'], 'ballpark figure = 대략적인 수치. 기획 회의 단골.'),
  E("I'll keep that in mind.", '명심할게요 / 참고할게요.', '피드백·조언을 받았을 때', [
    ['A', 'Try to lead with the result next time.', '다음엔 결과부터 말해 봐요.'],
    ['B', "Thanks, I'll keep that in mind.", '감사해요, 명심할게요.'],
  ], ["That's really helpful feedback.", "I'll work on that."], '피드백을 방어하지 않고 받는 태도 자체가 평가 포인트다.'),
]

module.exports = { ENGLISH_FALLBACK }
