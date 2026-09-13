/**
 * 가계부 PWA v3 backend
 * 쓰기 요청은 프로젝트 원칙대로 GET + query string만 사용한다.
 */
var TOKEN = '여기를_바꿔줘_아무도_모를_문자열';
var APP_ID = 'ledger';
var SCHEMA_VERSION = 3;
var SHEET = '거래';
var HEAD = ['id','날짜','월','유형','금액','대분류','소분류','결제수단','메모','고정비','수정시각','삭제','기기ID','서버리비전'];
var PROP_STORE = 'LEDGER_STORE_ID';
var PROP_REV = 'LEDGER_REV';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  if (action === 'ping') return json_({ok:true, appId:APP_ID, schemaVersion:SCHEMA_VERSION, serverTime:Date.now()});
  if (p.token !== TOKEN) return json_({ok:false, code:'AUTH', error:'토큰이 달라. 앱 설정과 Code.gs를 맞춰줘.'});
  try {
    if (action === 'meta') return json_(meta_());
    if (action === 'getAll') return json_(getAllResponse_(p.sinceRev));
    if (action === 'upsert') {
      var payload = parsePayload_(p.payload);
      var lock = LockService.getScriptLock();
      lock.waitLock(25000);
      try {
        var result = upsertRows_(payload.rows || []);
        var m = meta_();
        result.ok = true; result.appId = APP_ID; result.schemaVersion = SCHEMA_VERSION;
        result.storeId = m.storeId; result.serverTime = m.serverTime; result.cursor = m.cursor;
        return json_(result);
      } finally { try { lock.releaseLock(); } catch (_) {} }
    }
    return json_({ok:false, code:'ACTION', error:'알 수 없는 action: ' + action});
  } catch (err) {
    return json_({ok:false, code:'SERVER', error:String(err && err.message ? err.message : err)});
  }
}

function doPost() {
  return json_({ok:false, code:'POST_DISABLED', error:'POST는 지원하지 않아. 최신 앱은 GET 방식만 사용해.'});
}

function parsePayload_(text) {
  try { return JSON.parse(text || '{}'); }
  catch (_) { throw new Error('요청 형식이 이상해'); }
}

function meta_() {
  return {ok:true, appId:APP_ID, schemaVersion:SCHEMA_VERSION, storeId:getStoreId_(), serverTime:Date.now(), cursor:getRev_()};
}

function getStoreId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_STORE);
  if (!id) { id = Utilities.getUuid(); props.setProperty(PROP_STORE, id); }
  return id;
}
function getRev_() { return Number(PropertiesService.getScriptProperties().getProperty(PROP_REV)) || 0; }
function nextRev_() {
  var props = PropertiesService.getScriptProperties();
  var n = (Number(props.getProperty(PROP_REV)) || 0) + 1;
  props.setProperty(PROP_REV, String(n));
  return n;
}

function validateDate_(s) {
  s = String(s || '');
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  var y=Number(m[1]), mo=Number(m[2]), d=Number(m[3]);
  var dt = new Date(y,mo-1,d);
  return dt.getFullYear()===y && dt.getMonth()===mo-1 && dt.getDate()===d;
}
function cleanStr_(v,max) {
  var s = String(v == null ? '' : v).trim();
  if (s.length > max) throw new Error('문자열 길이가 제한을 넘었어');
  return s;
}
function validateRow_(r) {
  if (!r || typeof r !== 'object') throw new Error('거래 데이터가 비어 있어');
  var id = cleanStr_(r.id,120); if (!id) throw new Error('id가 없어');
  if (!validateDate_(r.date)) throw new Error('날짜 형식이 잘못됐어: ' + r.date);
  var type = cleanStr_(r.type,10); if (['지출','수입','이체'].indexOf(type) < 0) throw new Error('유형이 잘못됐어');
  var amount = Number(r.amount); if (!isFinite(amount) || amount <= 0 || amount > 9999999999) throw new Error('금액이 잘못됐어');
  var updated = Number(r.updated); if (!isFinite(updated) || updated <= 946684800000) throw new Error('수정시각이 잘못됐어');
  if (updated > Date.now() + 7*24*60*60*1000) throw new Error('기기 시간이 너무 미래로 설정돼 있어');
  return {
    id:id,date:String(r.date),type:type,amount:Math.round(amount),cat:cleanStr_(r.cat,40),sub:cleanStr_(r.sub,40),
    pay:cleanStr_(r.pay,40),memo:cleanStr_(r.memo,200),fixed:!!r.fixed,deleted:!!r.deleted,updated:updated,
    deviceId:cleanStr_(r.deviceId || '',120)
  };
}
function compareVersion_(aUpdated,aDevice,bUpdated,bDevice) {
  aUpdated=Number(aUpdated)||0; bUpdated=Number(bUpdated)||0;
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? 1 : -1;
  aDevice=String(aDevice||''); bDevice=String(bDevice||'');
  if (aDevice === bDevice) return 0;
  return aDevice > bDevice ? 1 : -1;
}

function upsertRows_(rows) {
  if (!Array.isArray(rows)) throw new Error('rows가 배열이 아니야');
  if (rows.length > 100) throw new Error('한 요청에 너무 많은 거래가 들어왔어');
  var sh = sheet_();
  var last = sh.getLastRow();
  var index = {}, existing = {};
  if (last > 1) {
    var vals = sh.getRange(2,1,last-1,HEAD.length).getValues();
    for (var i=0;i<vals.length;i++) if (vals[i][0]) {
      var id=String(vals[i][0]); index[id]=i+2;
      existing[id]={updated:toMs_(vals[i][10]),deviceId:String(vals[i][12]||''),row:vals[i]};
    }
  }
  var saved=0, skipped=0, conflicts=[], appends=[];
  for (var j=0;j<rows.length;j++) {
    var r = validateRow_(rows[j]);
    var at=index[r.id], old=existing[r.id];
    if (at && compareVersion_(old.updated,old.deviceId,r.updated,r.deviceId) >= 0) {
      skipped++; conflicts.push({id:r.id,serverUpdated:old.updated,serverDeviceId:old.deviceId}); continue;
    }
    var rev=nextRev_();
    var line=toLine_(r,rev);
    if (at) sh.getRange(at,1,1,HEAD.length).setValues([line]); else appends.push(line);
    saved++;
  }
  if (appends.length) sh.getRange(sh.getLastRow()+1,1,appends.length,HEAD.length).setValues(appends);
  if (saved) sortByDate_(sh);
  return {saved:saved,skipped:skipped,conflicts:conflicts};
}

function getAllResponse_(sinceRevParam) {
  var sinceRev = Number(sinceRevParam);
  var incremental = isFinite(sinceRev) && sinceRev > 0;
  var rows = getAllRows_(incremental ? sinceRev : 0);
  var m = meta_();
  return {ok:true, appId:APP_ID, schemaVersion:SCHEMA_VERSION, storeId:m.storeId, serverTime:m.serverTime, cursor:m.cursor, incremental:incremental, rows:rows};
}
function getAllRows_(sinceRev) {
  var sh=sheet_(), last=sh.getLastRow(); if (last<2) return [];
  var vals=sh.getRange(2,1,last-1,HEAD.length).getValues();
  var tz=SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), out=[];
  for (var i=0;i<vals.length;i++) {
    var row=vals[i]; if (!row[0]) continue;
    var rev=Number(row[13])||0;
    if (sinceRev && rev && rev <= sinceRev) continue;
    if (sinceRev && !rev) continue;
    out.push({
      id:String(row[0]), date:formatDate_(row[1],tz), type:String(row[3]||''), amount:Number(row[4])||0,
      cat:String(row[5]||''), sub:String(row[6]||''), pay:String(row[7]||''), memo:String(row[8]||''),
      fixed:row[9]==='Y'||row[9]===true, updated:toMs_(row[10]), deleted:row[11]==='Y'||row[11]===true,
      deviceId:String(row[12]||''), revision:rev
    });
  }
  return out;
}
function formatDate_(v,tz) { return v instanceof Date ? Utilities.formatDate(v,tz,'yyyy-MM-dd') : String(v||''); }
function toMs_(v) { return v instanceof Date ? v.getTime() : (Number(v)||0); }
function toLine_(r,rev) {
  var p=r.date.split('-'), d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]));
  return [r.id,d,r.date.slice(0,7),r.type,r.amount,r.cat,r.sub,r.pay,r.memo,r.fixed?'Y':'',new Date(r.updated),r.deleted?'Y':'',r.deviceId,rev];
}

function sheet_() {
  var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=ss.getSheetByName(SHEET); if (!sh) sh=ss.insertSheet(SHEET);
  if (sh.getLastRow()===0) sh.getRange(1,1,1,HEAD.length).setValues([HEAD]);
  else if (sh.getLastColumn()<HEAD.length) {
    var c=sh.getLastColumn(); sh.getRange(1,c+1,1,HEAD.length-c).setValues([HEAD.slice(c)]);
  }
  return sh;
}
function sortByDate_(sh) { var last=sh.getLastRow(); if (last>2) sh.getRange(2,1,last-1,HEAD.length).sort([{column:2,ascending:false}]); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function assignMissingRevisions_(sh) {
  var last=sh.getLastRow(); if (last<2) return;
  var vals=sh.getRange(2,14,last-1,1).getValues(), changed=false;
  for (var i=0;i<vals.length;i++) if (!Number(vals[i][0])) { vals[i][0]=nextRev_(); changed=true; }
  if (changed) sh.getRange(2,14,vals.length,1).setValues(vals);
}

function setup() {
  var ss=SpreadsheetApp.getActiveSpreadsheet(), sh=sheet_(); getStoreId_(); assignMissingRevisions_(sh);
  sh.getRange(1,1,1,HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#211E31').setFontColor('#EDEAF5');
  sh.setFrozenRows(1); sh.getRange('B:B').setNumberFormat('yyyy-mm-dd'); sh.getRange('E:E').setNumberFormat('#,##0'); sh.getRange('K:K').setNumberFormat('yyyy-mm-dd hh:mm');
  sh.setColumnWidth(1,110); sh.setColumnWidth(9,220);
  var m=ss.getSheetByName('월간요약')||ss.insertSheet('월간요약'); m.clear();
  m.getRange('A1').setValue('월별 흐름').setFontWeight('bold');
  m.getRange('A2').setFormula("=IFERROR(QUERY(거래!A2:N, \"select C, sum(E) where D='수입' and L<>'Y' group by C order by C desc label C '월', sum(E) '수입'\",0),\"기록 없음\")");
  m.getRange('D2').setFormula("=IFERROR(QUERY(거래!A2:N, \"select C, sum(E) where D='지출' and L<>'Y' group by C order by C desc label C '월', sum(E) '지출'\",0),\"\")");
  m.getRange('G1').setValue('고정비만').setFontWeight('bold');
  m.getRange('G2').setFormula("=IFERROR(QUERY(거래!A2:N, \"select C, sum(E) where D='지출' and J='Y' and L<>'Y' group by C order by C desc label C '월', sum(E) '고정비'\",0),\"\")");
  m.getRange('B:B').setNumberFormat('#,##0'); m.getRange('E:E').setNumberFormat('#,##0'); m.getRange('H:H').setNumberFormat('#,##0');
  var c=ss.getSheetByName('카테고리별')||ss.insertSheet('카테고리별'); c.clear();
  c.getRange('A1').setValue('보고 싶은 달'); c.getRange('B1').setValue(Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),'yyyy-MM')).setFontWeight('bold');
  c.getRange('A3').setFormula("=IFERROR(QUERY(거래!A2:N, \"select F, G, sum(E) where D='지출' and L<>'Y' and C='\"&$B$1&\"' group by F, G order by sum(E) desc label F '대분류', G '소분류', sum(E) '금액'\",0),\"기록 없음\")");
  c.getRange('F3').setFormula("=IFERROR(QUERY(거래!A2:N, \"select H, sum(E) where D='지출' and L<>'Y' and C='\"&$B$1&\"' group by H order by sum(E) desc label H '결제수단', sum(E) '금액'\",0),\"\")");
  c.getRange('C:C').setNumberFormat('#,##0'); c.getRange('G:G').setNumberFormat('#,##0');
  SpreadsheetApp.getUi().alert('v3 준비 끝. 배포 관리에서 새 버전으로 다시 배포해줘.');
}
