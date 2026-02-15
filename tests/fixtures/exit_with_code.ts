const rawCode = Deno.env.get("EXIT_CODE") ?? "1";
const code = Number(rawCode);

if (!Number.isInteger(code) || code < 0 || code > 255) {
  throw new Error(`Invalid EXIT_CODE: ${rawCode}`);
}

Deno.exit(code);
