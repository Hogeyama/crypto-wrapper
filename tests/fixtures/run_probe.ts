const outputPath = Deno.env.get("PROBE_OUTPUT");
const mountDir = Deno.env.get("PROBE_MOUNT_DIR");

if (!outputPath) {
  throw new Error("PROBE_OUTPUT is required.");
}

if (!mountDir) {
  throw new Error("PROBE_MOUNT_DIR is required.");
}

let mountWriteOk = false;
try {
  await Deno.mkdir(mountDir, { recursive: true });
  const markerPath = `${mountDir}/probe-marker.txt`;
  await Deno.writeTextFile(markerPath, "ok\n");
  const content = await Deno.readTextFile(markerPath);
  mountWriteOk = content.trim() === "ok";
} catch {
  mountWriteOk = false;
}

const payload = {
  apiToken: Deno.env.get("API_TOKEN") ?? "",
  profile: Deno.env.get("CRYPTOW_PROFILE") ?? "",
  mountWriteOk,
};

await Deno.writeTextFile(outputPath, JSON.stringify(payload, null, 2) + "\n");
