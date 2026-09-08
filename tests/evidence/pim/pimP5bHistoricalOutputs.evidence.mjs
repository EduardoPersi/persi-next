import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

test("artefatos e outputs históricos P5-B permanecem imutáveis",()=>{const fixture=JSON.parse(readFileSync("tests/evidence/pim/pim-p5b-historical-outputs.json","utf8")),digest=value=>createHash("sha256").update(value).digest("hex"),resultsText=readFileSync(fixture.sourceArtifacts.results),diagnosticText=readFileSync(fixture.sourceArtifacts.product4Diagnostic),results=JSON.parse(resultsText),diagnostic=JSON.parse(diagnosticText);assert.equal(digest(resultsText),fixture.sourceArtifacts.resultsSha256);assert.equal(digest(diagnosticText),fixture.sourceArtifacts.product4DiagnosticSha256);for(const expected of fixture.outputs){const parsed=expected.product===4?JSON.parse(diagnostic.rawOutputText):results.results.find(item=>item.batchIndex===expected.product).compactModelOutput;assert.equal(digest(JSON.stringify(parsed)),expected.parsedSha256);}});
