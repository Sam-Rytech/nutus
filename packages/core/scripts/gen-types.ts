// Generates src/generated/{instance,factory}.ts from the committed contract
// ABIs (packages/core/abi), so the TypeScript side can't drift from the Rust
// side. Run: pnpm --filter @nutus/core gen
import { readFileSync, writeFileSync } from "node:fs";
import { compile, type JSONSchema } from "json-schema-to-typescript";

interface AbiFn {
  name: string;
  doc?: string;
  kind: "view" | "call";
  modifiers?: string[];
  params?: { args: { name: string; type_schema: JSONSchema }[] };
  result?: { type_schema: JSONSchema };
}

const here = new URL("..", import.meta.url);
const pascal = (s: string) => s.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());

/** AccountId and friends carry page-long Rust docs; keep the types readable. */
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "description" && typeof v === "string" && v.length > 200) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return node;
}

for (const contract of ["instance", "factory"]) {
  const abi = JSON.parse(readFileSync(new URL(`abi/nutus_${contract}_abi.json`, here), "utf8"));
  // Promise-returning methods have a bare `true` schema: nothing useful to type.
  const definitions = Object.fromEntries(
    Object.entries(strip(abi.body.root_schema.definitions) as Record<string, JSONSchema | boolean>).map(([k, v]) => [
      k,
      typeof v === "boolean" ? {} : v,
    ]),
  ) as Record<string, JSONSchema>;
  const fns: AbiFn[] = abi.body.functions.filter(
    (f: AbiFn) => !(f.modifiers ?? []).includes("private") && f.name !== "contract_source_metadata",
  );

  const properties: Record<string, JSONSchema> = {};

  for (const f of fns) {
    const args = f.params?.args ?? [];
    properties[`${pascal(f.name)}Args`] = {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(args.map((a) => [a.name, strip(a.type_schema) as JSONSchema])),
      required: args
        .filter((a) => {
          const t = a.type_schema as { type?: unknown; anyOf?: { type?: string }[] };
          const nullable =
            (Array.isArray(t.type) && t.type.includes("null")) || (t.anyOf ?? []).some((x) => x.type === "null");
          return !nullable;
        })
        .map((a) => a.name),
    };
    if (f.result) {
      const r = strip(f.result.type_schema) as JSONSchema | boolean;
      properties[`${pascal(f.name)}Result`] = typeof r === "boolean" ? {} : r;
    }
  }

  const ts = await compile(
    // Everything is a named definition, so each Args/Result gets its own exported type.
    { title: `Nutus${pascal(contract)}Abi`, type: "object", additionalProperties: false, definitions: { ...definitions, ...properties } },
    `Nutus${pascal(contract)}Abi`,
    { bannerComment: `/* Generated from abi/nutus_${contract}_abi.json by scripts/gen-types.ts. Do not edit. */`, unreachableDefinitions: true, additionalProperties: false, style: { printWidth: 110 } },
  );

  // A result that is just a $ref uses that type; a bare `true` (Promise) is unknown.
  const resultType = (f: AbiFn): string => {
    if (!f.result) return "void";
    const r = f.result.type_schema as JSONSchema | boolean;
    if (typeof r === "boolean" || Object.keys(r).length === 0) return "unknown";
    if (r.$ref && Object.keys(r).length === 1) return r.$ref.split("/").pop()!;
    const name = `${pascal(f.name)}Result`;
    // The generator folds away schemas with nothing to type (e.g. Option<Promise>).
    return new RegExp(`export (type|interface) ${name}\\b`).test(ts) ? name : "unknown";
  };
  const methods = fns
    .map((f) => `  ${f.name}: { kind: "${f.kind}"; payable: ${(f.modifiers ?? []).includes("payable")}; args: ${pascal(f.name)}Args; result: ${resultType(f)} };`)
    .join("\n");
  writeFileSync(
    new URL(`src/generated/${contract}.ts`, here),
    `${ts}\n/** Every public method of the ${contract} contract. */\nexport interface ${pascal(contract)}Methods {\n${methods}\n}\n`,
  );
  console.log(`${contract}: ${fns.length} methods, ${Object.keys(definitions).length} types`);
}
