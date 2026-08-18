// ============================================================
// 카카오톡/페이스북 등 봇이 링크를 미리보기 카드로 만들 때만 동작하는 미들웨어.
// 일반 사용자가 접속할 때는 아무 것도 안 하고 그대로 통과시켜서, 평소 사이트 속도/동작에 영향 없음.
//
// 동작:
//   1) 주소에 ?deck=키워드 가 있고
//   2) 요청을 보낸 게 카카오톡/페북/트위터 등 "링크 미리보기 봇"이면
//   -> Firestore에서 그 키워드에 해당하는 덱 이름을 찾아서
//   -> index.html의 og:title / og:description / <title> 을 그 덱 이름으로 바꿔서 응답.
//
// 그 외의 경우(일반 사용자 접속, deck 파라미터 없음, 매칭 실패 등)는
// 그냥 undefined를 반환해서 평소처럼 정적 파일이 그대로 나가도록 함.
// ============================================================

export const config = { matcher: '/' };

const FIREBASE_PROJECT_ID = 'jh-695bd';
const COLLECTIONS = ['guild_atk_db', 'guild_def_db', 'guild_total_db'];

// 링크 미리보기를 만드는 대표적인 봇들의 User-Agent 패턴
const BOT_UA_PATTERN = /kakaotalk|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|LinkedInBot|WhatsApp|Discordbot/i;

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
      // 이 컬렉션에서 실패하면 다음 컬렉션 계속 시도
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
  try {
    const url = new URL(request.url);
    const deckParam = url.searchParams.get('deck');
    const ua = request.headers.get('user-agent') || '';

    // deck 파라미터가 없거나, 봇이 아니면(=일반 사용자) 그냥 평소대로 통과
    if (!deckParam || !BOT_UA_PATTERN.test(ua)) {
      return;
    }

    const deckName = await findDeckNameByKeyword(decodeURIComponent(deckParam).trim());
    if (!deckName) {
      return; // 못 찾았으면 그냥 기본 정적 파일로 통과
    }

    // 원본 정적 파일을 그대로 가져와서 메타태그만 치환
    const htmlRes = await fetch(new URL('/index.html', request.url));
    if (!htmlRes.ok) return;
    let html = await htmlRes.text();

    const title = escapeHtml(`${deckName} 카운터 - 도면`);
    const desc = escapeHtml(`[${deckName}] 카운터덱 공략을 확인하세요.`);

    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${title}">`)
      .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${desc}">`)
      .replace(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${title}">`)
      .replace(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${desc}">`);

    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  } catch (e) {
    // 어떤 이유로든 실패하면 절대 사이트를 막지 않고 평소대로 통과
    return;
  }
}
