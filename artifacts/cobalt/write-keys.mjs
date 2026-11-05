import { writeFile } from "node:fs/promises";

const key = process.env.COBALT_API_KEY;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!key || !uuidV4Pattern.test(key)) {
  throw new Error("COBALT_API_KEY must be a UUIDv4 set in the Render environment group.");
}

await writeFile(
  "/tmp/cobalt-keys.json",
  JSON.stringify({
    [key]: {
      name: "hutaotik-api",
      allowedServices: ["tiktok"],
    },
  }),
  { mode: 0o600 }
);
