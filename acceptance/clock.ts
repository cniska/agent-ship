let now = Date.now();

Date.now = () => now;

Reflect.set(Bun, "sleepSync", (ms: number) => {
  now += ms;
});
