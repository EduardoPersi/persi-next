import {exactRationalFromDecimalText} from "./rational.ts";

const unitMap:Record<string,string>={mm:"mm",cm:"cm",m:"m",pol:'"',v:"V",a:"A",w:"W",kw:"kW",cv:"CV",hp:"HP",k:"K",l:"L",ml:"ml",kg:"kg",g:"g"};
const fraction='(?:\\d+\\s+)?\\d+\\s*\\/\\s*\\d+';
const number='\\d+(?:[.,]\\d+)?';
// A3.5E-P2-F fix: a unit token must not be an area/volume marker in disguise.
// "320 m²"/"320 m2"/"25cm²"/"25cm2" etc. would otherwise satisfy the old
// negative lookahead `(?![\p{L}])`, because "²" and a plain digit "2" are
// both non-letters — the regex happily matched "320 m" as a length and left
// the "²"/"2" dangling unconsumed. Real case: SKU SV2001 "Rendimento: Até
// 320 m² por demão" (paint coverage yield, an AREA, not a product length)
// was mislabeled comprimento=320m. The same trap applies to m³/cm³/mm³
// (volume) even though volume is normalized separately. Excluding a
// trailing superscript/plain 2 or 3 right after the unit letter closes all
// of these at the tokenizer level, before any attribute classification runs.
//
// A3.5E-P2-G-V2 audit finding: broadened from "just 2 or 3" to ANY trailing
// digit. SKUs 62619-62623 "Esticador ... 1/4 - M6" (a metric bolt-size
// designation, e.g. M6/M8/M10) — the fraction's denominator ("4") followed
// by " M" from "M6" satisfied the old digit-2-or-3-only exclusion (since
// "6" is neither 2 nor 3), producing a phantom comprimento=4M. No genuine
// commercial length notation ever has a unit letter immediately followed
// by another digit with no separator — "10m20" is not a real measurement
// — so excluding any trailing 0-9 (not just 2/3) closes this without
// costing any real case.
const AREA_OR_VOLUME_MARKER='[\\u00B2\\u00B30-9]';
// A3.5E-P2-M, Achado C: SKU 38796 "Manta Asfáltica ... 01m X 10m112527"
// (title) has its own SKU/internal code digits glued directly onto the
// right-hand side of a genuine "A x B" dimension pair with no separator.
// The compound alternatives below correctly refuse the whole "01m X
// 10m112527" span (the shared trailing lookahead rejects a unit letter
// immediately followed by another digit), but the engine then backtracks to
// the SIMPLE single-value alternative and matches "01m" alone, silently
// discarding the fact that it was structurally the left side of an "A x B"
// pair whose right side simply failed to parse — not an independent,
// freestanding measurement. A number+unit immediately followed by (or
// immediately preceded by) an "x/×/—"-shaped separator and another digit is
// never a standalone value in this catalog's real usage: either the whole
// compound parses (and the earlier alternatives already win), or it does
// not and the correct answer is to emit NO candidate at all (fail-closed,
// matching this codebase's established standard — see the nut-and-bolt and
// terminal-component cases in context-exclusion.ts) rather than guess which
// half is meaningful. Guarded on both sides (lookbehind for a
// left-contaminated compound, lookahead for a right-contaminated one) even
// though only the right-contaminated shape has a confirmed real instance —
// the guard is symmetric by construction, not an enumerated case list.
const SIMPLE_VALUE_NOT_ADJACENT_TO_COMPOUND_SEPARATOR='(?<!\\d\\s*[xX\\u00d7—]\\s*)(?:'+number+'\\s*(?:mm|cm|kW|CV|HP|ml|kg|V|A|W|K|L|m|g))(?!\\s*[xX\\u00d7—]\\s*\\d)';
export const measurementPattern=new RegExp(`(?:(?:${number}\\s*(?:mm|cm|m)|${fraction}\\s*(?:"|pol))\\s*[xX—]\\s*(?:${number}\\s*(?:mm|cm|m)|${fraction}(?:\\s*(?:"|pol))?)|${number}\\s*[xX—]\\s*${number}\\s*(?:mm|cm|m)|${fraction}\\s*(?:"|pol)|${SIMPLE_VALUE_NOT_ADJACENT_TO_COMPOUND_SEPARATOR})(?!${AREA_OR_VOLUME_MARKER})(?![\\p{L}])`,"giu");

export function confidenceBand(value:number){return value>=.85?"HIGH" as const:value>=.6?"MEDIUM" as const:"LOW" as const;}
export function normalizeMeasurement(raw:string){
 let value=raw.trim().replace(/—/g,"x").replace(/(\d|mm|cm|m|")\s*[xX]\s*(?=\d)/gi,"$1 x ").replace(/(\d)\s+(mm|cm|m|V|A|W|kW|CV|HP|K|L|ml|kg|g)\b/gi,"$1$2").replace(/\s*\/\s*/g,"/");
 value=value.replace(/\bpol(?:\.|\b)/gi,'"').replace(/(\d)\s*"/g,'$1"');
 if(/(?:mm|cm|m) x (?:\d+ )?\d+\/\d+$/i.test(value))value+='"';
 value=value.replace(/(\d)(mm|cm|kw|cv|hp|ml|kg|v|a|w|k|l|g)\b/gi,(_,digit,unit)=>`${digit}${unitMap[unit.toLowerCase()]??unit}`);
 value=value.replace(/^(\d+)\.(\d{3})K$/,(_,whole,thousands)=>`${whole}${thousands}K`);
 value=value.replace(/\d+(?:[.,]\d+)?/g,token=>{
  const number=Number(token.replace(",","."));
  if(!Number.isFinite(number))return token;
  return Number.isInteger(number)?String(number):String(number).replace(".",",");
 });
 return value;
}
export function detectUnit(value:string){const match=value.match(/\d\s*(kW|CV|HP|mm|cm|ml|kg|V|A|W|K|L|m|g|")(?=$|\s|x)/);return match?.[1]??null;}
export function extractMeasurements(text:string){return [...text.matchAll(measurementPattern)].filter(match=>match.index===0||!/[\p{L}\d]/u.test(text[(match.index??0)-1])).map(match=>({raw:match[0],normalized:normalizeMeasurement(match[0])}));}

export type MeasurementComponent={raw:string;numerator:number;denominator:number;unit:string|null};
// A3.5D-F fix #1: display/raw casing is never touched (a "6M" title stays
// "6M" — see normalizeMeasurement, which deliberately never canonicalizes
// bare meter casing so the commercial representation survives verbatim).
// But the STRUCTURED unit resolved here must be canonical regardless of how
// the source text capitalized it ("6M"/"6m" -> "m", "500ML"/"100ml" -> "mL",
// "1l"/"1L" -> "L"), because it has to resolve to a real public.units.code
// later. Order matters: longer/more specific tokens (mm, cm, mL) must be
// checked before the shorter tokens they could otherwise be mistaken for
// (bare m, bare L) — mL is checked before L, and mm/cm are checked before m.
const UNIT_PATTERNS:ReadonlyArray<readonly[RegExp,string]>=[
 [/mm$/i,"mm"],[/cm$/i,"cm"],[/mL$/i,"mL"],[/kg$/,"kg"],
 [/kW$/,"kW"],[/CV$/,"CV"],[/HP$/,"HP"],[/K$/,"K"],
 [/L$/i,"L"],[/V$/,"V"],[/A$/,"A"],[/W$/,"W"],[/"$/,"\""],
 [/g$/,"g"],[/m$/i,"m"],
];
const sideUnit=(side:string):string|null=>{for(const[pattern,canonical]of UNIT_PATTERNS)if(pattern.test(side))return canonical;return null;};
const fractionPattern=/^(\d+\s+)?(\d+)\s*\/\s*(\d+)/;
function parseSide(side:string,inheritedUnit:string|null):MeasurementComponent{
 const trimmed=side.trim(),unit=sideUnit(trimmed)??inheritedUnit,fraction=trimmed.match(fractionPattern);
 if(fraction){const whole=fraction[1]?Number(fraction[1].trim()):0,numerator=Number(fraction[2]),denominator=Number(fraction[3]);return{raw:trimmed,numerator:whole*denominator+numerator,denominator,unit};}
 // A3.5E-P2-H-R2A: was `Number(numberMatch[0].replace(",","."))` assigned
 // directly as `numerator` with `denominator:1` — mathematically wrong for
 // any non-integer value (attribute_values.measurement_numerator/
 // _denominator are BIGINT; "0,625" produced a JS float that Postgres
 // rejected outright — see lib/pim/rational.ts for the full root-cause
 // account). exactRationalFromDecimalText converts the TEXT directly to a
 // fully-reduced integer numerator/denominator pair via BigInt arithmetic,
 // never through a float intermediate.
 const numberMatch=trimmed.match(/-?\d+(?:[.,]\d+)?/);
 if(!numberMatch)return{raw:trimmed,numerator:NaN,denominator:1,unit};
 const{numerator,denominator}=exactRationalFromDecimalText(numberMatch[0]);
 return{raw:trimmed,numerator,denominator,unit};
}
// Decomposes a normalized measurement (simple or compound "A x B") into
// structured components, preserving each side's own original unit — never
// cross-converts between systems (e.g. a 3/4" side stays a fraction of
// inches, it is never turned into a millimeter decimal). A bare number on
// one side of a compound (e.g. "32 x 25mm") inherits the other side's unit,
// matching the same shared-unit convention already used for comparison in
// conflictComparisonKey.
export function parseMeasurementComponents(normalized:string):MeasurementComponent[]{
 const sides=normalized.split(/\s+x\s+/i);
 if(sides.length===1)return[parseSide(sides[0],null)];
 const trailingUnit=sideUnit(sides[sides.length-1].trim());
 return sides.map(side=>parseSide(side,trailingUnit));
}
