/**
 * A small moment.js for scripts, like the `moment` Postman's sandbox has: `moment()`, `moment(value, format)`,
 * `add/subtract`, `startOf/endOf`, `format`, `diff`, `isBefore/isAfter/isSame`, `unix`, `toISOString` … Times
 * are UTC (the sandbox has no local time zone), so `moment()` and `moment.utc()` are the same. Loaded into
 * the sandbox only for scripts that mention `moment`.
 */
export const MOMENT_SOURCE = String.raw`
(function () {
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var UNITS = { y: 'year', year: 'year', years: 'year', Q: 'quarter', quarter: 'quarter', quarters: 'quarter', M: 'month', month: 'month', months: 'month',
    w: 'week', week: 'week', weeks: 'week', d: 'day', day: 'day', days: 'day', date: 'day', h: 'hour', hour: 'hour', hours: 'hour',
    m: 'minute', minute: 'minute', minutes: 'minute', s: 'second', second: 'second', seconds: 'second', ms: 'millisecond', millisecond: 'millisecond', milliseconds: 'millisecond' };
  var MS = { week: 6048e5, day: 864e5, hour: 36e5, minute: 6e4, second: 1e3, millisecond: 1 };
  var TOKENS = /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|A|a|ZZ|Z|X|x/g;
  var pad = function (n, w) { var s = String(Math.abs(n)); while (s.length < (w || 2)) s = '0' + s; return (n < 0 ? '-' : '') + s; };
  var unit = function (u) { var k = UNITS[u] || UNITS[String(u || '').toLowerCase()]; if (!k) throw new Error('moment: unknown unit "' + u + '"'); return k; };
  var daysIn = function (y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); };
  var ordinal = function (n) { var t = n % 100; return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); };

  function parseWith(str, fmt) {
    var parts = { YYYY: 1970, MM: 1, DD: 1, HH: 0, mm: 0, ss: 0, SSS: 0 };
    var names = [];
    var re = String(fmt).replace(/[.*+?^$(){}|\\]/g, '\\$&').replace(/\\?\[([^\]]*)\\?\]|YYYY|YY|MM|M|DD|D|HH|H|hh|h|mm|m|ss|s|SSS|A|a|X|x/g, function (t, lit) {
      if (lit !== undefined) return lit;
      names.push(t);
      return t === 'YYYY' ? '(\\d{4})' : t === 'SSS' ? '(\\d{1,3})' : t === 'A' || t === 'a' ? '([AaPp][Mm])' : t === 'X' || t === 'x' ? '(-?\\d+)' : '(\\d{1,2})';
    });
    var m = new RegExp('^' + re).exec(String(str));
    if (!m) return NaN;
    var pm = null;
    for (var i = 0; i < names.length; i++) {
      var t = names[i], v = m[i + 1];
      if (t === 'X') return Number(v) * 1000;
      if (t === 'x') return Number(v);
      if (t === 'A' || t === 'a') pm = /p/i.test(v);
      else if (t === 'YY') parts.YYYY = 2000 + Number(v);
      else parts[t === 'M' ? 'MM' : t === 'D' ? 'DD' : t === 'H' || t === 'hh' || t === 'h' ? 'HH' : t === 'm' ? 'mm' : t === 's' ? 'ss' : t] = Number(v);
    }
    if (pm !== null) parts.HH = (parts.HH % 12) + (pm ? 12 : 0);
    return Date.UTC(parts.YYYY, parts.MM - 1, parts.DD, parts.HH, parts.mm, parts.ss, parts.SSS);
  }

  function Moment(ms) { this._ms = ms; }
  var P = Moment.prototype;
  P._d = function () { return new Date(this._ms); };
  P.isValid = function () { return !isNaN(this._ms); };
  P.clone = function () { return new Moment(this._ms); };
  P.valueOf = function () { return this._ms; };
  P.unix = function () { return Math.floor(this._ms / 1000); };
  P.toDate = function () { return this._d(); };
  P.toISOString = function () { return this.isValid() ? this._d().toISOString() : null; };
  P.toJSON = P.toISOString;
  P.toString = function () { return this.isValid() ? this.format('ddd MMM DD YYYY HH:mm:ss [GMT+0000]') : 'Invalid date'; };
  P.utc = P.local = function () { return this; };
  P.utcOffset = function () { return 0; };
  P.daysInMonth = function () { var d = this._d(); return daysIn(d.getUTCFullYear(), d.getUTCMonth()); };

  var getset = function (get, set) {
    return function (v) {
      if (v === undefined) return get(this._d());
      var d = this._d(); set(d, Number(v)); this._ms = d.getTime(); return this;
    };
  };
  P.year = getset(function (d) { return d.getUTCFullYear(); }, function (d, v) { d.setUTCFullYear(v); });
  P.month = getset(function (d) { return d.getUTCMonth(); }, function (d, v) { d.setUTCMonth(v); });
  P.date = getset(function (d) { return d.getUTCDate(); }, function (d, v) { d.setUTCDate(v); });
  P.day = getset(function (d) { return d.getUTCDay(); }, function (d, v) { d.setUTCDate(d.getUTCDate() - d.getUTCDay() + v); });
  P.hour = P.hours = getset(function (d) { return d.getUTCHours(); }, function (d, v) { d.setUTCHours(v); });
  P.minute = P.minutes = getset(function (d) { return d.getUTCMinutes(); }, function (d, v) { d.setUTCMinutes(v); });
  P.second = P.seconds = getset(function (d) { return d.getUTCSeconds(); }, function (d, v) { d.setUTCSeconds(v); });
  P.millisecond = P.milliseconds = getset(function (d) { return d.getUTCMilliseconds(); }, function (d, v) { d.setUTCMilliseconds(v); });
  P.get = function (u) { return this[unit(u) === 'day' ? 'date' : unit(u)](); };
  P.set = function (u, v) { return this[unit(u) === 'day' ? 'date' : unit(u)](v); };

  P.add = function (n, u) {
    if (n && typeof n === 'object') { for (var k in n) this.add(n[k], k); return this; }
    n = Number(n);
    var k2 = unit(u || 'ms');
    if (k2 === 'year' || k2 === 'quarter' || k2 === 'month') {
      var months = n * (k2 === 'year' ? 12 : k2 === 'quarter' ? 3 : 1);
      var d = this._d(), day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + months);
      d.setUTCDate(Math.min(day, daysIn(d.getUTCFullYear(), d.getUTCMonth())));
      this._ms = d.getTime();
    } else this._ms += n * MS[k2];
    return this;
  };
  P.subtract = function (n, u) {
    if (n && typeof n === 'object') { for (var k in n) this.add(-n[k], k); return this; }
    return this.add(-Number(n), u);
  };
  P.startOf = function (u) {
    var k = unit(u), d = this._d();
    var y = d.getUTCFullYear(), mo = d.getUTCMonth(), da = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
    if (k === 'year') this._ms = Date.UTC(y, 0, 1);
    else if (k === 'quarter') this._ms = Date.UTC(y, mo - (mo % 3), 1);
    else if (k === 'month') this._ms = Date.UTC(y, mo, 1);
    else if (k === 'week') this._ms = Date.UTC(y, mo, da - d.getUTCDay());
    else if (k === 'day') this._ms = Date.UTC(y, mo, da);
    else if (k === 'hour') this._ms = Date.UTC(y, mo, da, h);
    else if (k === 'minute') this._ms = Date.UTC(y, mo, da, h, mi);
    else if (k === 'second') this._ms = Date.UTC(y, mo, da, h, mi, s);
    return this;
  };
  P.endOf = function (u) { return this.startOf(u).add(1, u).subtract(1, 'ms'); };

  P.format = function (fmt) {
    if (!this.isValid()) return 'Invalid date';
    var d = this._d();
    var Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), W = d.getUTCDay(), H = d.getUTCHours();
    var self = this;
    return String(fmt || 'YYYY-MM-DDTHH:mm:ss[Z]').replace(TOKENS, function (t, lit) {
      if (lit !== undefined) return lit;
      switch (t) {
        case 'YYYY': return pad(Y, 4);
        case 'YY': return pad(Y % 100);
        case 'Q': return String(Math.floor(M / 3) + 1);
        case 'MMMM': return MONTHS[M];
        case 'MMM': return MONTHS[M].slice(0, 3);
        case 'MM': return pad(M + 1);
        case 'M': return String(M + 1);
        case 'Do': return ordinal(D);
        case 'DD': return pad(D);
        case 'D': return String(D);
        case 'dddd': return DAYS[W];
        case 'ddd': return DAYS[W].slice(0, 3);
        case 'dd': return DAYS[W].slice(0, 2);
        case 'd': return String(W);
        case 'HH': return pad(H);
        case 'H': return String(H);
        case 'hh': return pad(H % 12 || 12);
        case 'h': return String(H % 12 || 12);
        case 'mm': return pad(d.getUTCMinutes());
        case 'm': return String(d.getUTCMinutes());
        case 'ss': return pad(d.getUTCSeconds());
        case 's': return String(d.getUTCSeconds());
        case 'SSS': return pad(d.getUTCMilliseconds(), 3);
        case 'A': return H < 12 ? 'AM' : 'PM';
        case 'a': return H < 12 ? 'am' : 'pm';
        case 'Z': return '+00:00';
        case 'ZZ': return '+0000';
        case 'X': return String(self.unix());
        case 'x': return String(self._ms);
      }
      return t;
    });
  };

  var other = function (x) { return x instanceof Moment ? x._ms : moment(x)._ms; };
  var monthDiff = function (a, b) {
    var da = new Date(a), db = new Date(b);
    var whole = (da.getUTCFullYear() - db.getUTCFullYear()) * 12 + (da.getUTCMonth() - db.getUTCMonth());
    var anchor = moment(b).add(whole, 'M')._ms;
    var next, frac;
    if (a - anchor < 0) { next = moment(b).add(whole - 1, 'M')._ms; frac = (a - anchor) / (anchor - next); }
    else { next = moment(b).add(whole + 1, 'M')._ms; frac = (a - anchor) / (next - anchor); }
    return whole + frac;
  };
  P.diff = function (x, u, asFloat) {
    var b = other(x), k = unit(u || 'ms'), r;
    if (k === 'year' || k === 'quarter' || k === 'month') r = monthDiff(this._ms, b) / (k === 'year' ? 12 : k === 'quarter' ? 3 : 1);
    else r = (this._ms - b) / MS[k];
    return asFloat ? r : r < 0 ? Math.ceil(r) : Math.floor(r);
  };
  P.isBefore = function (x, u) { return u ? this.clone().endOf(u)._ms < other(x) : this._ms < other(x); };
  P.isAfter = function (x, u) { return u ? this.clone().startOf(u)._ms > other(x) : this._ms > other(x); };
  P.isSame = function (x, u) { if (!u) return this._ms === other(x); var s = this.clone().startOf(u)._ms, o = other(x); return o >= s && o <= this.clone().endOf(u)._ms; };
  P.isSameOrBefore = function (x, u) { return this.isSame(x, u) || this.isBefore(x, u); };
  P.isSameOrAfter = function (x, u) { return this.isSame(x, u) || this.isAfter(x, u); };
  P.isBetween = function (a, b) { return this._ms > other(a) && this._ms < other(b); };
  P.fromNow = function () {
    var s = Math.round((Date.now() - this._ms) / 1000), a = Math.abs(s), t;
    if (a < 45) t = 'a few seconds'; else if (a < 5400) t = Math.max(1, Math.round(a / 60)) + ' minutes'; else if (a < 129600) t = Math.round(a / 3600) + ' hours';
    else if (a < 2592000) t = Math.round(a / 86400) + ' days'; else if (a < 31536000) t = Math.round(a / 2592000) + ' months'; else t = Math.round(a / 31536000) + ' years';
    return s >= 0 ? t + ' ago' : 'in ' + t;
  };

  function moment(input, fmt) {
    if (input instanceof Moment) return input.clone();
    if (input === undefined || input === null) return new Moment(Date.now());
    if (input instanceof Date) return new Moment(input.getTime());
    if (typeof input === 'number') return new Moment(input);
    if (Array.isArray(input)) return new Moment(Date.UTC(input[0], input[1] || 0, input[2] === undefined ? 1 : input[2], input[3] || 0, input[4] || 0, input[5] || 0, input[6] || 0));
    if (fmt) return new Moment(parseWith(input, fmt));
    var s = String(input);
    var ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00Z') : /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(s) ? Date.parse(s + 'Z') : Date.parse(s);
    return new Moment(ms);
  }
  moment.utc = moment;
  moment.unix = function (s) { return new Moment(Number(s) * 1000); };
  moment.isMoment = function (x) { return x instanceof Moment; };
  moment.now = function () { return Date.now(); };
  moment.duration = function (n, u) {
    var ms = typeof n === 'object' ? Object.keys(n).reduce(function (t, k) { return t + n[k] * (MS[unit(k)] || 0); }, 0) : Number(n) * (MS[unit(u || 'ms')] || 0);
    var as = function (k) { return ms / MS[unit(k)]; };
    return { asMilliseconds: function () { return ms; }, asSeconds: function () { return as('s'); }, asMinutes: function () { return as('m'); }, asHours: function () { return as('h'); }, asDays: function () { return as('d'); }, as: as, valueOf: function () { return ms; } };
  };
  globalThis.moment = moment;
})();
`;
