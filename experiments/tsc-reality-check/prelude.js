// prelude.js — pure-ES5 environment shims so TypeScript 4.9.5 (ES5-syntax,
// ES6-library) can run on the trireme engine. Everything here is legal ES5.
var globalThis = this;

function __mkIter(arr, pick) {
  var i = 0;
  return { next: function () {
    if (i < arr.length) { var v = arr[i++]; return { value: pick(v), done: false }; }
    return { value: undefined, done: true };
  } };
}
function __pkey(k) {
  var t = typeof k;
  if (t === "string") return "s:" + k;
  if (t === "number") return "n:" + k;
  if (t === "boolean") return "b:" + k;
  if (k === null) return "null";
  if (k === undefined) return "undef";
  return null;
}
var __HOLE = { hole: true };

// Insertion-ordered Map matching the ES6 behaviors TypeScript relies on:
// insertion-order iteration, and forEach VISITING entries added during the
// callback (the checker defers work into Maps mid-iteration).
function Map(pairs) {
  this._ks = [];   // keys in insertion order; deleted slots become __HOLE
  this._vs = [];
  this._idx = {};  // primitive-key tag -> index
  this._n = 0;
  if (pairs) for (var i = 0; i < pairs.length; i++) this.set(pairs[i][0], pairs[i][1]);
}
Map.prototype._find = function (k) {
  var p = __pkey(k);
  if (p !== null) {
    var i = this._idx[p];
    return i === undefined ? -1 : i;
  }
  for (var j = 0; j < this._ks.length; j++) if (this._ks[j] === k) return j;
  return -1;
};
Map.prototype.set = function (k, v) {
  var i = this._find(k);
  if (i >= 0) { this._vs[i] = v; return this; }
  var p = __pkey(k);
  this._ks.push(k); this._vs.push(v);
  if (p !== null) this._idx[p] = this._ks.length - 1;
  this._n++;
  return this;
};
Map.prototype.get = function (k) { var i = this._find(k); return i < 0 ? undefined : this._vs[i]; };
Map.prototype.has = function (k) { return this._find(k) >= 0; };
Map.prototype["delete"] = function (k) {
  var i = this._find(k);
  if (i < 0) return false;
  var p = __pkey(k);
  if (p !== null) delete this._idx[p];
  this._ks[i] = __HOLE; this._vs[i] = undefined;
  this._n--;
  return true;
};
Map.prototype.clear = function () { this._ks = []; this._vs = []; this._idx = {}; this._n = 0; };
Map.prototype.forEach = function (cb, thisArg) {
  // index-walk the live arrays: appends during the callback are visited,
  // deletions before their visit are skipped — ES6 Map semantics.
  for (var i = 0; i < this._ks.length; i++) {
    if (this._ks[i] === __HOLE) continue;
    cb.call(thisArg, this._vs[i], this._ks[i], this);
  }
};
Map.prototype._snapshot = function () {
  var out = [];
  for (var i = 0; i < this._ks.length; i++) if (this._ks[i] !== __HOLE) out.push([this._ks[i], this._vs[i]]);
  return out;
};
Map.prototype.keys = function () { return __mkIter(this._snapshot(), function (e) { return e[0]; }); };
Map.prototype.values = function () { return __mkIter(this._snapshot(), function (e) { return e[1]; }); };
Map.prototype.entries = function () { return __mkIter(this._snapshot(), function (e) { return [e[0], e[1]]; }); };
Object.defineProperty(Map.prototype, "size", { get: function () { return this._n; }, configurable: true });

function Set(items) {
  this._m = new Map();
  if (items) for (var i = 0; i < items.length; i++) this._m.set(items[i], true);
}
Set.prototype.add = function (v) { this._m.set(v, true); return this; };
Set.prototype.has = function (v) { return this._m.has(v); };
Set.prototype["delete"] = function (v) { return this._m["delete"](v); };
Set.prototype.clear = function () { this._m.clear(); };
Set.prototype.forEach = function (cb, thisArg) {
  var self = this;
  this._m.forEach(function (_v, k) { cb.call(thisArg, k, k, self); });
};
Set.prototype.keys = Set.prototype.values = function () { return this._m.keys(); };
Set.prototype.entries = function () { return __mkIter(this._m._snapshot(), function (e) { return [e[0], e[0]]; }); };
Object.defineProperty(Set.prototype, "size", { get: function () { return this._m._n; }, configurable: true });

// Minimal Uint16Array stand-in for ts.parsePseudoBigInt (zero-filled,
// length, indexed access; no write-masking — sufficient because the
// pseudo-bigint VALUE feeds only type analysis, never emitted text).
function Uint16Array(n) {
  for (var i = 0; i < n; i++) this[i] = 0;
  this.length = n;
}

function WeakMap() { this._k = []; this._v = []; } // leaky ES5 stand-in
WeakMap.prototype.set = function (k, v) {
  var i = this._k.indexOf(k);
  if (i < 0) { this._k.push(k); this._v.push(v); } else this._v[i] = v;
  return this;
};
WeakMap.prototype.get = function (k) { var i = this._k.indexOf(k); return i < 0 ? undefined : this._v[i]; };
WeakMap.prototype.has = function (k) { return this._k.indexOf(k) >= 0; };
WeakMap.prototype["delete"] = function (k) {
  var i = this._k.indexOf(k);
  if (i < 0) return false;
  this._k.splice(i, 1); this._v.splice(i, 1); return true;
};

if (!Object.assign) Object.assign = function (t) {
  for (var i = 1; i < arguments.length; i++) {
    var s = arguments[i];
    if (s == null) continue;
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k];
  }
  return t;
};
if (!Object.entries) Object.entries = function (o) {
  var out = [];
  for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out.push([k, o[k]]);
  return out;
};
if (!Array.from) Array.from = function (x, f) {
  var out = [], i;
  if (x && typeof x.length === "number") { for (i = 0; i < x.length; i++) out.push(x[i]); }
  else if (x && typeof x.next === "function") { for (var r = x.next(); !r.done; r = x.next()) out.push(r.value); }
  if (f) for (i = 0; i < out.length; i++) out[i] = f(out[i], i);
  return out;
};
if (!String.prototype.startsWith) String.prototype.startsWith = function (s, pos) {
  pos = pos || 0; return this.indexOf(s, pos) === pos;
};
if (!String.prototype.endsWith) String.prototype.endsWith = function (s, end) {
  var str = String(this); if (end === undefined || end > str.length) end = str.length;
  return str.substring(end - s.length, end) === s;
};
if (!String.prototype.includes) String.prototype.includes = function (s, pos) { return this.indexOf(s, pos || 0) >= 0; };
if (!String.prototype.trimStart) String.prototype.trimStart = function () { return String(this).replace(/^\s+/, ""); };
if (!String.prototype.trimEnd) String.prototype.trimEnd = function () { return String(this).replace(/\s+$/, ""); };
if (!String.prototype.repeat) String.prototype.repeat = function (n) {
  var out = "", s = String(this);
  for (var i = 0; i < n; i++) out += s;
  return out;
};
if (!String.prototype.codePointAt) String.prototype.codePointAt = function (i) {
  var s = String(this), a = s.charCodeAt(i);
  if (a >= 0xd800 && a <= 0xdbff && i + 1 < s.length) {
    var b = s.charCodeAt(i + 1);
    if (b >= 0xdc00 && b <= 0xdfff) return (a - 0xd800) * 0x400 + (b - 0xdc00) + 0x10000;
  }
  return a;
};
if (!String.fromCodePoint) String.fromCodePoint = function () {
  var out = "";
  for (var i = 0; i < arguments.length; i++) {
    var c = arguments[i];
    if (c > 0xffff) { c -= 0x10000; out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff)); }
    else out += String.fromCharCode(c);
  }
  return out;
};

if (!Array.prototype.find) Array.prototype.find = function (pred, thisArg) {
  for (var i = 0; i < this.length; i++) { if (pred.call(thisArg, this[i], i, this)) return this[i]; }
  return undefined;
};
if (!Array.prototype.findIndex) Array.prototype.findIndex = function (pred, thisArg) {
  for (var i = 0; i < this.length; i++) { if (pred.call(thisArg, this[i], i, this)) return i; }
  return -1;
};
if (!Array.prototype.fill) Array.prototype.fill = function (v, start, end) {
  var len = this.length;
  start = start === undefined ? 0 : start; end = end === undefined ? len : end;
  for (var i = start; i < end; i++) this[i] = v;
  return this;
};
if (!Array.prototype.includes) Array.prototype.includes = function (v, from) {
  for (var i = from || 0; i < this.length; i++) { if (this[i] === v || (v !== v && this[i] !== this[i])) return true; }
  return false;
};
