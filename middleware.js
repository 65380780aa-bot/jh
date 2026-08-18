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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // 항상 실제 정적 파일(index.html)을 명시적으로 가져온다.
  // "/" 이 아니라 "/index.html"로 직접 요청해야, 이 미들웨어 자신을 다시 트리거하는
  // 무한루프에 빠지지 않는다 (config.matcher가 "/" 경로만 잡고 있으므로).
  let html;
  try {
    const staticRes = await fetch(new URL('/index.html', request.url));
    if (!staticRes.ok) {
      // 정적 파일 자체를 못 가져오면, 아무것도 건드리지 않고 그 응답을 그대로 반환.
      return staticRes;
    }
    html = await staticRes.text();
  } catch (e) {
    // 정적 파일 fetch 자체가 실패하면 안전하게 500 대신 아주 단순한 안내만 반환.
    // (거의 발생하지 않겠지만, 혹시라도 사용자가 빈 화면을 보는 것보다 나음)
    return new Response('일시적인 오류입니다. 새로고침 해주세요.', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  try {
    const deckParam = url.searchParams.get('deck');
    const ua = request.headers.get('user-agent') || '';

    // deck 파라미터가 없거나 봇이 아니면(=일반 사용자) 방금 가져온 index.html을 그대로 반환
    if (!deckParam || !BOT_UA_PATTERN.test(ua)) {
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    const keyword = decodeURIComponent(deckParam).trim();
    const deckName = await findDeckNameByKeyword(keyword);
    if (!deckName) {
      // 못 찾았어도 원본 그대로 반환 (에러 아님)
      return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    // 키워드 없이 고정 문구만 사용
    const title = escapeHtml(`카운터 덱 확인`);

    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`);

    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (e) {
    // 봇 감지/Firestore 조회 중 어떤 이유로든 에러가 나도, 이미 가져온 정상 html을 그대로 반환.
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}
