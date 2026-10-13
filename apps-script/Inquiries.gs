/**
 * Living Mood — سحب الاستفسارات من Supabase لجوجل شيت أول بأول
 * ==============================================================
 * التركيب (مرة واحدة):
 * 1) افتح الشيت ← Extensions ← Apps Script ← امسح الكود والزق الملف ده ← Save.
 * 2) Project Settings (الترس) ← Script properties ← Add:
 *      SUPABASE_KEY = (Supabase ← Project Settings ← API Keys ← service_role / secret key)
 *    ⚠️ المفتاح ده سري — مايتحطش في الكود ولا يتبعت لحد.
 * 3) ارجع للكود، اختار الدالة setup من فوق ودوس Run ← وافق على الصلاحيات.
 *    خلاص: الشيت بيتحدّث لوحده كل دقيقة، وفيه منيو "Living Mood" للتحديث اليدوي.
 */

const SUPABASE_URL = 'https://ppiokabsxhklamhlrzzw.supabase.co';
const SHEET_NAME = 'Inquiries';
const INCLUDE_VIEWS = false; // true لو عايز مشاهدات المنتجات كمان تنزل في الشيت (كتير)

const HEADERS = ['#', 'التاريخ', 'الوقت', 'النوع', 'المنتج', 'التصنيف', 'اسم العميل', 'رقم العميل', 'واتساب العميل', 'الإيميل', 'العنوان', 'الرسالة', 'الحالة', 'لينك المنتج'];
const TYPE_AR = { whatsapp: 'واتساب', call: 'اتصال', form: 'طلب سعر', view: 'مشاهدة' };
const STATUS_AR = { new: 'جديد', contacted: 'اتكلمنا معاه', done: 'خلص' };
const SITE_URL = 'https://livingmoood-commits.github.io/Catalog/';
const STATUS_COL = HEADERS.indexOf('الحالة') + 1;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Living Mood')
    .addItem('تحديث الاستفسارات دلوقتي', 'syncInquiries')
    .addItem('إعادة سحب كل البيانات', 'resyncAll')
    .addToUi();
}

/** يشغّل مرة واحدة: يجهّز الشيت ويعمل تحديث تلقائي كل دقيقة */
function setup() {
  getKey_();
  const sh = getSheet_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncInquiries')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncInquiries').timeBased().everyMinutes(1).create();
  syncInquiries();
  SpreadsheetApp.getActive().toast('تمام ✓ الشيت هيتحدّث لوحده كل دقيقة', 'Living Mood', 6);
  return sh.getName();
}

/** يسحب الجديد بس ويحدّث حالة الصفوف القديمة */
function syncInquiries() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const sh = getSheet_();
    const rows = fetchAll_();
    const existing = {};
    const last = sh.getLastRow();
    if (last > 1) {
      sh.getRange(2, 1, last - 1, 1).getValues().forEach((r, i) => { if (r[0] !== '') existing[r[0]] = i + 2; });
    }

    const toAppend = [];
    rows.forEach(r => {
      const status = STATUS_AR[r.status] || r.status || '';
      if (existing[r.id]) {
        // تحديث الحالة لو اتغيّرت من لوحة الأدمن
        const cell = sh.getRange(existing[r.id], STATUS_COL);
        if (cell.getValue() !== status) cell.setValue(status);
        return;
      }
      toAppend.push(toRow_(r));
    });

    if (toAppend.length) {
      // الأحدث فوق: ندخّل الصفوف الجديدة تحت العناوين مباشرة
      toAppend.reverse();
      sh.insertRowsAfter(1, toAppend.length);
      sh.getRange(2, 1, toAppend.length, HEADERS.length).setValues(toAppend.reverse());
      styleRows_(sh, 2, toAppend.length);
    }
    PropertiesService.getScriptProperties().setProperty('LAST_SYNC', new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

function resyncAll() {
  const sh = getSheet_();
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  syncInquiries();
}

// ---------------------------------------------------------------

function fetchAll_() {
  const key = getKey_();
  let filter = INCLUDE_VIEWS ? '' : '&type=neq.view';
  const out = [];
  const pageSize = 1000;
  for (let from = 0; from < 20000; from += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/inquiries?select=*&order=created_at.desc${filter}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Range: `${from}-${from + pageSize - 1}` },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code >= 300) throw new Error('Supabase error ' + code + ': ' + res.getContentText().slice(0, 300));
    const batch = JSON.parse(res.getContentText());
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out.reverse(); // الأقدم الأول عشان الترقيم
}

function toRow_(r) {
  const d = new Date(r.created_at);
  const tz = Session.getScriptTimeZone() || 'Africa/Cairo';
  const phone = r.customer_phone || '';
  return [
    r.id,
    Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    Utilities.formatDate(d, tz, 'hh:mm a'),
    TYPE_AR[r.type] || r.type,
    r.product_name || 'عام',
    r.category_name || '',
    r.customer_name || '',
    phone ? "'" + phone : '',
    phone ? waLink_(phone) : '',
    r.customer_email || '',
    r.customer_address || '',
    r.message || '',
    STATUS_AR[r.status] || r.status || '',
    r.product_id ? SITE_URL + '#p-' + encodeURIComponent(r.product_id) : '',
  ];
}

function waLink_(phone) {
  let n = String(phone).replace(/[^\d]/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '20' + n.slice(1);
  return 'https://wa.me/' + n;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head.join('|') !== HEADERS.join('|')) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
      .setFontWeight('bold').setFontColor('#F3EFEA').setBackground('#1C1712')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 34);
    sh.setRightToLeft(true);
    [60, 95, 80, 85, 200, 130, 140, 120, 200, 200, 220, 280, 110, 220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
    const rule = (text, bg, fg) => SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([sh.getRange('D2:D'), sh.getRange(2, STATUS_COL, sh.getMaxRows() - 1, 1)]).build();
    sh.setConditionalFormatRules([
      rule('طلب سعر', '#F4ECDF', '#8F6F3F'),
      rule('واتساب', '#E7F8EE', '#1F9C46'),
      rule('اتصال', '#EEE9E2', '#1C1712'),
      rule('جديد', '#FCEFD9', '#B7791F'),
      rule('اتكلمنا معاه', '#EAF0F6', '#3B5B7A'),
      rule('خلص', '#E7F3EC', '#3C7A5C'),
    ]);
  }
  return sh;
}

function styleRows_(sh, start, n) {
  sh.getRange(start, 1, n, HEADERS.length)
    .setFontWeight('normal').setFontColor('#1C1712').setBackground(null)
    .setVerticalAlignment('middle').setWrap(true);
  sh.getRange(start, 1, n, 4).setHorizontalAlignment('center');
  sh.getRange(start, STATUS_COL, n, 1).setHorizontalAlignment('center');
}

function getKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
  if (!key) throw new Error('حط SUPABASE_KEY في Project Settings ← Script properties الأول (service_role key من Supabase).');
  return key;
}
