// Derive search tokens during deployment, not on the visitor's first question.
// This transforms indexes only; original texts and citations remain unchanged.
import fs from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { prepareSubjects } from "../site/relevance.mjs";

const root = path.resolve(process.argv[2] || "_site");
const catalog = JSON.parse(
  await fs.readFile(path.join(root, "catalog.json"), "utf8"),
);
const vocabulary = JSON.parse(
  await fs.readFile(path.join(root, "vocabulary.json"), "utf8"),
);
for (const meta of catalog) {
  if (!/^[a-z0-9-]+$/.test(meta.id)) throw Error("Invalid source identity");
  const directory = path.join(root, "data", meta.id);
  const compressed = meta.compression === "gzip";
  const bytes = await fs.readFile(
    path.join(directory, "index.json" + (compressed ? ".gz" : "")),
  );
  const index = JSON.parse(
    compressed ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"),
  );
  if (index.length !== meta.units) throw Error("Incomplete source index");
  const { documents } = prepareSubjects(index, vocabulary);
  const output = Buffer.from(
    JSON.stringify(documents.map((d) => [[...d.title], [...d.question]])),
  );
  const artifact = compressed ? gzipSync(output, { level: 9 }) : output;
  await fs.writeFile(
    path.join(directory, "subjects.json" + (compressed ? ".gz" : "")),
    artifact,
  );
  meta.hashes["subjects.json"] = createHash("sha256")
    .update(artifact)
    .digest("hex");
  meta.has_subjects = true;
  console.log(
    `${meta.id}: ${documents.length} prepared subjects; ${artifact.length} bytes`,
  );
}
await fs.writeFile(path.join(root, "catalog.json"), JSON.stringify(catalog));
