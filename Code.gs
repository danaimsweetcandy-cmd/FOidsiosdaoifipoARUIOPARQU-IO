/**
 * 가계부 PWA ↔ 구글 시트 연동 (Google Sheets가 원본, PWA는 캐시)
 *
 * 쓰는 순서
 *  1) 아래 TOKEN을 아무도 모를 문자열로 바꾼다 (앱 설정에도 같은 값을 넣는다)
 *  2) 상단 함수 목록에서 setup 을 골라 한 번 실행 (권한 승인 필요)
 *  3) 배포 > 새 배포 > 유형 '웹 앱'
 *       실행 계정: 나
 *       액세스 권한: 모든 사용자
 *     → 나오는 /exec 주소를 앱 설정의 '웹앱 주소'에 붙여넣는다
 *
 * 코드를 고친 뒤에는 '배포 관리 > 편집 > 버전: 새 버전'으로 다시 배포해야 반영된다.
 *
 * 클라이언트(app.js)는 모든 요청을 GET + query string(action, token, payload)으로 보낸다.
 * doPost는 더 이상 실제 처리를 하지 않는다 (Apps Script 리다이렉트 중 POST body가
 * 사라지는 문제 때문에 이 프로젝트에서는 쓰기 요청에 POST를 쓰지 않기로 함).
 */

var TOKEN = '여기를_바꿔줘_아무도_모를_문자열';
var SHEET = '거래';
// 12번째 컬럼(삭제)은 tombstone 방식 삭제 표시용. 'Y'면 삭제된 것으로 취급한다.
var HEAD = ['id', '날짜', '월', '유형', '금액', '대분류', '소분류', '결제수단', '메모', '고정비', '수정시각', '삭제'];

/* ───────── 웹앱 진입점 ───────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';

  if (action === 'ping') {
    return json({ ok: true, msg: '가계부 수신 대기 중' });
  }

  if (p.token !== TOKEN) {
    return json({ ok: false, error: '토큰이 달라. 앱 설정과 Code.gs를 맞춰줘.' });
  }

  if (action === 'getAll') {
    try {
      return json({ ok: true, rows: getAllRows_() });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  }

  if (action === 'upsert') {
    var payload;
    try {
      payload = JSON.parse(p.payload || '{}');
    } catch (err) {
      return json({ ok: false, error: '요청 형식이 이상해' });
    }
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(25000);
      var result = upsertRows_(payload.rows || []);
      return json({ ok: true, saved: result.saved, skipped: result.skipped });
    } catch (err) {
      return json({ ok: false, error: String(err && err.message ? err.message : err) });
    } finally {
      try { lock.releaseLock(); } catch (e2) {}
    }
  }

  return json({ ok: false, error: '알 수 없는 action: ' + action });
}

function doPost(e) {
  // 이 프로젝트의 클라이언트는 더 이상 POST를 사용하지 않는다.
  // (Apps Script 웹앱의 내부 리다이렉트 과정에서 POST body가 사라지는 문제 때문)
  return json({ ok: false, error: 'POST는 더 이상 지원하지 않아. 앱을 최신 버전으로 갱신해줘.' });
}

/* ───────── 핵심 로직 ───────── */

function upsertRows_(rows) {
  var sh = sheet();
  var last = sh.getLastRow();
  var index = {};        // id -> 시트 행 번호
  var existingUpdated = {}; // id -> 기존 updated(ms)

  if (last > 1) {
    var range = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
    for (var i = 0; i < range.length; i++) {
      var id = range[i][0];
      if (!id) continue;
      index[String(id)] = i + 2;
      var upd = range[i][10];
      existingUpdated[String(id)] = upd instanceof Date ? upd.getTime() : (Number(upd) || 0);
    }
  }

  var appends = [];
  var saved = 0, skipped = 0;

  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    if (!r || !r.id) { skipped++; continue; }
    var incomingUpdated = Number(r.updated) || Date.now();
    var at = index[String(r.id)];
    var existing = at ? existingUpdated[String(r.id)] : null;

    // 서버에 이미 더 최신(같거나 큰 updated) 데이터가 있으면 이번 요청은 무시한다.
    // (오래된 기기가 최신 데이터를 덮어쓰는 것을 막기 위함)
    if (at && existing !== null && existing >= incomingUpdated) {
      skipped++;
      continue;
    }

    var line = toLine(r, incomingUpdated);
    if (at) {
      sh.getRange(at, 1, 1, HEAD.length).setValues([line]);
    } else {
      appends.push(line);
    }
    saved++;
  }

  if (appends.length) {
    sh.getRange(sh.getLastRow() + 1, 1, appends.length, HEAD.length).setValues(appends);
  }
  sortByDate(sh);
  return { saved: saved, skipped: skipped };
}

function getAllRows_() {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEAD.length).getValues();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue;
    var dateObj = row[1];
    var updatedObj = row[10];
    // 삭제(tombstone)된 행도 그대로 포함해서 반환한다.
    // 다른 기기가 이 사실을 보고 자기 local 캐시에서도 지울 수 있어야 하기 때문이다.
    // 화면에 삭제된 거래를 보이지 않게 하는 처리는 클라이언트(app.js)의 mergeServerData가 한다.
    out.push({
      id: row[0],
      date: dateObj instanceof Date ? Utilities.formatDate(dateObj, tz, 'yyyy-MM-dd') : String(dateObj),
      type: row[3],
      amount: Number(row[4]) || 0,
      cat: row[5],
      sub: row[6],
      pay: row[7],
      memo: row[8],
      fixed: row[9] === 'Y' || row[9] === true,
      updated: updatedObj instanceof Date ? updatedObj.getTime() : (Number(updatedObj) || 0),
      deleted: row[11] === 'Y' || row[11] === true
    });
  }
  return out;
}

/* ───────── 헬퍼 ───────── */

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function toLine(r, updatedMs) {
  var p = String(r.date || '').split('-');
  var d = p.length === 3 ? new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])) : new Date();
  return [
    r.id,
    d,
    String(r.date || '').slice(0, 7),
    r.type || '',
    Number(r.amount) || 0,
    r.cat || '',
    r.sub || '',
    r.pay || '',
    r.memo || '',
    r.fixed ? 'Y' : '',
    new Date(updatedMs),
    r.deleted ? 'Y' : ''
  ];
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) sh = ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  } else {
    // 이전 버전 시트(삭제 컬럼이 없던 시절)를 쓰던 경우, 부족한 헤더만 채워서
    // 하위 호환으로 마이그레이션한다.
    var curCols = sh.getLastColumn();
    if (curCols < HEAD.length) {
      sh.getRange(1, curCols + 1, 1, HEAD.length - curCols).setValues([HEAD.slice(curCols)]);
    }
  }
  return sh;
}

function sortByDate(sh) {
  var last = sh.getLastRow();
  if (last > 2) sh.getRange(2, 1, last - 1, HEAD.length).sort([{ column: 2, ascending: false }]);
}

/* ───────── 최초 1회 실행 ───────── */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheet();

  sh.getRange(1, 1, 1, HEAD.length)
    .setFontWeight('bold').setBackground('#211E31').setFontColor('#EDEAF5');
  sh.setFrozenRows(1);
  sh.getRange('B:B').setNumberFormat('yyyy-mm-dd');
  sh.getRange('E:E').setNumberFormat('#,##0');
  sh.getRange('K:K').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setColumnWidth(1, 110);
  sh.setColumnWidth(9, 220);

  // 아래 요약 시트들은 삭제(tombstone)된 행(L열='Y')을 집계에서 제외한다.
  var m = ss.getSheetByName('월간요약') || ss.insertSheet('월간요약');
  m.clear();
  m.getRange('A1').setValue('월별 흐름').setFontWeight('bold');
  m.getRange('A2').setFormula(
    "=IFERROR(QUERY(거래!A2:L, \"select C, sum(E) where D='수입' and L<>'Y' group by C order by C desc label C '월', sum(E) '수입'\",0),\"기록 없음\")"
  );
  m.getRange('D2').setFormula(
    "=IFERROR(QUERY(거래!A2:L, \"select C, sum(E) where D='지출' and L<>'Y' group by C order by C desc label C '월', sum(E) '지출'\",0),\"\")"
  );
  m.getRange('G1').setValue('고정비만').setFontWeight('bold');
  m.getRange('G2').setFormula(
    "=IFERROR(QUERY(거래!A2:L, \"select C, sum(E) where D='지출' and J='Y' and L<>'Y' group by C order by C desc label C '월', sum(E) '고정비'\",0),\"\")"
  );
  m.getRange('B:B').setNumberFormat('#,##0');
  m.getRange('E:E').setNumberFormat('#,##0');
  m.getRange('H:H').setNumberFormat('#,##0');

  var c = ss.getSheetByName('카테고리별') || ss.insertSheet('카테고리별');
  c.clear();
  c.getRange('A1').setValue('보고 싶은 달');
  c.getRange('B1').setValue(Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM'));
  c.getRange('B1').setFontWeight('bold');
  c.getRange('A3').setFormula(
    "=IFERROR(QUERY(거래!A2:L, \"select F, G, sum(E) where D='지출' and L<>'Y' and C='\"&$B$1&\"' group by F, G order by sum(E) desc label F '대분류', G '소분류', sum(E) '금액'\",0),\"기록 없음\")"
  );
  c.getRange('F3').setFormula(
    "=IFERROR(QUERY(거래!A2:L, \"select H, sum(E) where D='지출' and L<>'Y' and C='\"&$B$1&\"' group by H order by sum(E) desc label H '결제수단', sum(E) '금액'\",0),\"\")"
  );
  c.getRange('C:C').setNumberFormat('#,##0');
  c.getRange('G:G').setNumberFormat('#,##0');

  SpreadsheetApp.getUi().alert('준비 끝. 이제 배포 > 새 배포 > 웹 앱으로 배포해줘.');
}
