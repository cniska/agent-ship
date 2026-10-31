let now = Date.now() + Number(process.env.CLOCK_STAND_IN_OFFSET_MS ?? 0);

Date.now = () => now;

Reflect.set(Bun, "sleepSync", (ms: number) => {
  now += ms;
});
