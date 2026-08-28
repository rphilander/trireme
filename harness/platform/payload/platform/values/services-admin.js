export const sink = [];
export const drainTrace = () => sink.splice(0, sink.length);
