// App Store Connect helper for the CramJam build swap. Prints states and IDs only, never emails or keys.
//
//   node scripts/asc.mjs status     <build>   read only: version 1.0, builds, review submission, beta groups
//   node scripts/asc.mjs attach     <build>   put <build> on version 1.0 in place of the current build
//   node scripts/asc.mjs testflight <build>   put <build> in every internal TestFlight group that has the build it replaces
//
// Env: ASC_KEY_FILE, ASC_KEY_ID, ASC_ISSUER_ID, APP_ID, SUBMISSION_ID, VERSION_STRING.
import crypto from "node:crypto";
import fs from "node:fs";

const { ASC_KEY_FILE, ASC_KEY_ID, ASC_ISSUER_ID, APP_ID, SUBMISSION_ID, VERSION_STRING } = process.env;
const [action, buildNumber] = process.argv.slice(2);
if (!["status", "attach", "testflight"].includes(action) || !/^\d+$/.test(buildNumber ?? "")) {
  console.error("usage: asc.mjs status|attach|testflight <build number>");
  process.exit(2);
}

function jwt() {
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input =
    b64u(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })) +
    "." +
    b64u(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(input), { key: fs.readFileSync(ASC_KEY_FILE), dsaEncoding: "ieee-p1363" });
  return input + "." + b64u(sig);
}

async function api(method, path, body) {
  const res = await fetch("https://api.appstoreconnect.apple.com" + path, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const errs = (() => { try { return JSON.parse(text).errors.map((e) => `${e.code}: ${e.detail}`).join("; "); } catch { return text.slice(0, 500); } })();
    throw new Error(`${method} ${path.split("?")[0]} -> ${res.status} ${errs}`);
  }
  return text ? JSON.parse(text) : {};
}

async function version() {
  // The store version may be named "1.0" while the builds carry CFBundleShortVersionString 1.0.0.
  const r = await api("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20&include=build&fields[appStoreVersions]=versionString,appStoreState,appVersionState,build&fields[builds]=version,processingState`);
  const short = (x) => x.replace(/(\.0)+$/, "");
  const matches = r.data.filter((v) => short(v.attributes.versionString) === short(VERSION_STRING));
  if (matches.length !== 1) throw new Error(`expected one iOS store version matching ${VERSION_STRING}, found ${matches.length} of ${r.data.length}`);
  const v = matches[0];
  const buildId = v.relationships.build.data?.id ?? null;
  const build = (r.included ?? []).find((b) => b.id === buildId);
  return { id: v.id, name: v.attributes.versionString, state: v.attributes.appVersionState ?? v.attributes.appStoreState, buildId, buildNumber: build?.attributes.version ?? null };
}

async function build(n) {
  const r = await api("GET", `/v1/builds?filter[app]=${APP_ID}&filter[version]=${n}&filter[preReleaseVersion.version]=${VERSION_STRING}&fields[builds]=version,processingState,usesNonExemptEncryption,expired,uploadedDate`);
  if (r.data.length > 1) throw new Error(`more than one build ${n} for ${VERSION_STRING}`);
  return r.data[0] ? { id: r.data[0].id, ...r.data[0].attributes } : null;
}

async function submission() {
  const s = await api("GET", `/v1/reviewSubmissions/${SUBMISSION_ID}?fields[reviewSubmissions]=state,platform,submittedDate`);
  const items = await api("GET", `/v1/reviewSubmissions/${SUBMISSION_ID}/items?limit=50&fields[reviewSubmissionItems]=state,appStoreVersion,appCustomProductPageVersion,appStoreVersionExperiment,appStoreVersionExperimentV2,appEvent,backgroundAssetVersion`);
  const rows = items.data.map((i) => {
    const rel = Object.entries(i.relationships ?? {}).find(([, v]) => v.data);
    return { id: i.id, state: i.attributes.state, kind: rel ? rel[0] : "unknown", target: rel ? rel[1].data.id : null };
  });
  return { state: s.data.attributes.state, submittedDate: s.data.attributes.submittedDate, items: rows };
}

async function groups() {
  const r = await api("GET", `/v1/apps/${APP_ID}/betaGroups?limit=50&fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds`);
  const out = [];
  for (const g of r.data) {
    const b = await api("GET", `/v1/betaGroups/${g.id}/builds?limit=200&fields[builds]=version`);
    const t = await api("GET", `/v1/betaGroups/${g.id}/betaTesters?limit=200&fields[betaTesters]=state`);
    out.push({ id: g.id, name: g.attributes.name, internal: g.attributes.isInternalGroup, allBuilds: g.attributes.hasAccessToAllBuilds,
      builds: b.data.map((x) => x.attributes.version).sort(), testers: t.data.length });
  }
  return out;
}

async function report(n) {
  const v = await version();
  console.log(`Store version ${v.name}: id ${v.id}, state ${v.state}, attached build ${v.buildNumber ?? "none"}`);
  for (const k of [...new Set([v.buildNumber, n].filter(Boolean))]) {
    const b = await build(k);
    console.log(b ? `Build ${k}: id ${b.id}, processing ${b.processingState}, usesNonExemptEncryption ${b.usesNonExemptEncryption}, expired ${b.expired}, uploaded ${b.uploadedDate}`
      : `Build ${k}: not in App Store Connect`);
  }
  const s = await submission();
  console.log(`Review submission ${SUBMISSION_ID}: state ${s.state}${s.submittedDate ? ", submitted " + s.submittedDate : ""}, ${s.items.length} items`);
  for (const i of s.items) console.log(`  item ${i.id}: ${i.kind} ${i.target} -> ${i.state}`);
  for (const g of await groups())
    console.log(`TestFlight group "${g.name}": ${g.internal ? "internal" : "external"}, all builds ${g.allBuilds}, ${g.testers} testers, builds [${g.builds.join(", ")}]`);
  return { v, s };
}

if (action === "status") {
  await report(buildNumber);
} else if (action === "attach") {
  const v = await version();
  const b = await build(buildNumber);
  if (!b) throw new Error(`build ${buildNumber} is not in App Store Connect yet`);
  if (b.processingState !== "VALID") throw new Error(`build ${buildNumber} is ${b.processingState}, not VALID`);
  if (v.buildNumber === buildNumber) console.log(`Version ${VERSION_STRING} already carries build ${buildNumber}`);
  else {
    await api("PATCH", `/v1/appStoreVersions/${v.id}/relationships/build`, { data: { type: "builds", id: b.id } });
    console.log(`Attached build ${buildNumber} to version ${VERSION_STRING} (was ${v.buildNumber})`);
  }
  const { v: after, s } = await report(buildNumber);
  const bad = s.items.filter((i) => i.state !== "READY_FOR_REVIEW");
  if (after.buildNumber !== buildNumber || bad.length) {
    console.error(`CHECK FAILED: version carries build ${after.buildNumber}; items not READY_FOR_REVIEW: ${bad.length}`);
    process.exit(1);
  }
  console.log(`CHECK PASSED: version ${VERSION_STRING} carries build ${buildNumber}; all ${s.items.length} items READY_FOR_REVIEW`);
} else {
  const b = await build(buildNumber);
  if (!b || b.processingState !== "VALID") throw new Error(`build ${buildNumber} is not VALID yet (${b?.processingState ?? "missing"})`);
  const prev = await build(String(Number(buildNumber) - 1));
  if (b.usesNonExemptEncryption == null) {
    if (prev?.usesNonExemptEncryption == null) throw new Error("export compliance is unanswered on both builds; answer it in App Store Connect");
    await api("PATCH", `/v1/builds/${b.id}`, { data: { type: "builds", id: b.id, attributes: { usesNonExemptEncryption: prev.usesNonExemptEncryption } } });
    console.log(`Export compliance on build ${buildNumber}: usesNonExemptEncryption ${prev.usesNonExemptEncryption}, the same answer as build ${Number(buildNumber) - 1}`);
  }
  for (const g of await groups()) {
    if (!g.internal) continue;
    if (g.builds.includes(buildNumber) || g.allBuilds) { console.log(`Group "${g.name}" already has build ${buildNumber} (all builds ${g.allBuilds})`); continue; }
    if (!g.builds.includes(String(Number(buildNumber) - 1))) continue;
    await api("POST", `/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: "builds", id: b.id }] });
    console.log(`Added build ${buildNumber} to internal group "${g.name}" (${g.testers} testers)`);
  }
  await report(buildNumber);
}
