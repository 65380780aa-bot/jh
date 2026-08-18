// ============================================================
// 카카오톡/페이스북 등 봇이 링크를 미리보기 카드로 만들 때만 제목/설명을 바꿔주는 미들웨어.
// 일반 사용자가 접속할 때도 항상 명시적으로 index.html을 가져와서 그대로 돌려줌
// (애매하게 "아무것도 반환 안 하면 알아서 통과되겠지" 하는 방식은 안 써서,
//  어떤 경우에도 빈 화면/네트워크 오류가 뜨지 않도록 보장함).
// ============================================================

// matcher는 vercel.json의 proxy.matcher 쪽에서 관리하므로 여기서는 정의하지 않음
// (양쪽에 다 정의하면 "충돌" 에러가 남)

const FIREBASE_PROJECT_ID = 'jh-695bd';
const COLLECTIONS = ['guild_atk_db', 'guild_def_db', 'guild_total_db'];

// 링크 미리보기를 만드는 대표적인 봇들의 User-Agent 패턴
const BOT_UA_PATTERN = /kakaotalk-scrap|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|LinkedInBot|WhatsApp|Discordbot/i;

async function findDeckNameByKeyword(keyword) {
  for (const collectionId of COLLECTIONS) {
    try {
      const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId }],
              where: {
                fieldFilter: {
                  field: { fieldPath: 'keywords' },
                  op: 'ARRAY_CONTAINS',
                  value: { stringValue: keyword }
                }
              },
              limit: 1
            }
          })
        }
      );
      if (!res.ok) continue;
      const rows = await res.json();
      const doc = Array.isArray(rows) ? rows.find(r => r.document)?.document : null;
      const name = doc?.fields?.name?.stringValue;
      if (name) return name;
    } catch (e) {
      continue;
    }
  }
  return null;
}

// tab 값별 카드 제목 (?tab=def, ?tab=total 처럼 특정 탭 전체를 여는 고정 링크용)
const TAB_TITLES = {
  def: '길드방어덱구성',
  total: '총력전덱구성'
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function withTitle(html, title, requestUrl) {
  const t = escapeHtml(title);
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${t}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${t}">`);
  // og:url을 쿼리 파라미터 포함한 실제 요청 주소로 채워서, 카카오가
  // ?deck=밀스실 / ?tab=def / ?tab=total 등을 서로 다른 페이지로 정확히 구분하게 함
  // (이게 없으면 카카오가 여러 링크를 같은 페이지로 착각해서 캐시가 서로 뒤섞일 수 있음)
  if (requestUrl) {
    const u = escapeHtml(requestUrl);
    if (/<meta property="og:url" content="[^"]*">/.test(out)) {
      out = out.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${u}">`);
    } else {
      out = out.replace(/<meta property="og:type" content="[^"]*">/, `$&\n  <meta property="og:url" content="${u}">`);
    }
  }
  return out;
}

// fetch()로 정적 파일을 그대로 가져와서 반환할 때, Content-Encoding(gzip 등) 헤더가
// 실제 전달되는 내용물과 안 맞아서 브라우저가 압축 해제에 실패하는 문제(ERR_CONTENT_DECODING_FAILED)가
// 생길 수 있어서, 그 헤더들을 지우고 안전하게 반환하는 헬퍼.
async function passThroughStatic(request) {
  const res = await fetch(new URL('/index.html', request.url));
  const headers = new Headers(res.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(res.body, { status: res.status, headers });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const deckParam = url.searchParams.get('deck');
  const tabParam = url.searchParams.get('tab');
  const ua = request.headers.get('user-agent') || '';
  const isBot = BOT_UA_PATTERN.test(ua);
  const isBotWithDeck = !!deckParam && isBot;
  const isBotWithTab = !deckParam && !!tabParam && TAB_TITLES[tabParam] && isBot;

  // 일반 사용자(카톡 인앱 브라우저로 실제 클릭해서 들어온 경우 포함)는
  // 아무것도 가공하지 않고 정적 파일을 그대로 스트리밍으로 전달.
  // (텍스트로 다 읽어서 새 Response를 만드는 것보다 이 방식이 한 단계 더 가볍다)
  if (!isBotWithDeck && !isBotWithTab) {
    try {
      return await passThroughStatic(request);
    } catch (e) {
      return new Response('일시적인 오류입니다. 새로고침 해주세요.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }

  // "?tab=def / ?tab=total" 고정 탭 링크는 Firestore 조회가 필요 없어서 훨씬 간단하게 처리.
  if (isBotWithTab) {
    try {
      const staticRes = await fetch(new URL('/index.html', request.url));
      if (!staticRes.ok) return staticRes;
      const html = await staticRes.text();
      return new Response(withTitle(html, TAB_TITLES[tabParam], request.url), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch (e) {
      try {
        return await passThroughStatic(request);
      } catch (e2) {
        return new Response('일시적인 오류입니다. 새로고침 해주세요.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
    }
  }

  // 여기서부터는 "카톡 등 링크 미리보기 봇 + ?deck= 파라미터가 있는 경우"만 해당.
  // 이 경로만 Firestore 조회 + 텍스트 치환이 들어가서 약간 더 느리지만,
  // 실제 사용자 클릭 경로에는 전혀 영향 없음.
  try {
    const staticRes = await fetch(new URL('/index.html', request.url));
    if (!staticRes.ok) return staticRes;
    let html = await staticRes.text();

    const keyword = decodeURIComponent(deckParam).trim();
    const deckName = await findDeckNameByKeyword(keyword);
    if (!deckName) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    html = withTitle(html, '카운터 덱 확인', request.url);
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e) {
    // 어떤 이유로든 실패하면 그냥 원본 정적 파일로 안전하게 폴백
    try {
      return await passThroughStatic(request);
    } catch (e2) {
      return new Response('일시적인 오류입니다. 새로고침 해주세요.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  }
}

