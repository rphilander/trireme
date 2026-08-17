import vm from "node:vm";
export function runSource(source) {
  const output = [];
  const sandbox = { print: (...args) => { output.push(args.map((a) => toStr(a)).join(" ")); } };
  function toStr(v) { return typeof v === "symbol" ? v.toString() : String(v); }
  try {
    vm.runInNewContext(source, sandbox, { timeout: 2000 });
    return { output, error: null };
  } catch (e) {
    const error = e && typeof e === "object" && "name" in e ? String(e.name) : String(e);
    return { output, error };
  }
}
