// Test 1: disable-next-line on multi-line function
// oxlint-disable-next-line max-params
function test1(
  a: string,
  b: number,
  c: boolean,
  d: string,
): void { void a; void b; void c; void d; }

// Test 2: block disable on multi-line function
// oxlint-disable max-params
function test2(
  a: string,
  b: number,
  c: boolean,
  d: string,
): void { void a; void b; void c; void d; }
// oxlint-enable max-params
