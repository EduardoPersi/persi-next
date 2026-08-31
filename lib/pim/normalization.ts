const unitMap:Record<string,string>={mm:"mm",cm:"cm",m:"m",pol:'"',v:"V",a:"A",w:"W",kw:"kW",cv:"CV",hp:"HP",k:"K",l:"L",ml:"ml",kg:"kg",g:"g"};
const fraction='(?:\\d+\\s+)?\\d+\\s*\\/\\s*\\d+';
const number='\\d+(?:[.,]\\d+)?';
export const measurementPattern=new RegExp(`(?:(?:${number}\\s*(?:mm|cm|m)|${fraction}\\s*(?:"|pol))\\s*[xX—]\\s*(?:${number}\\s*(?:mm|cm|m)|${fraction}(?:\\s*(?:"|pol))?)|${number}\\s*[xX—]\\s*${number}\\s*(?:mm|cm|m)|${fraction}\\s*(?:"|pol)|${number}\\s*(?:mm|cm|kW|CV|HP|ml|kg|V|A|W|K|L|m|g))(?![\\p{L}])`,"giu");

export function confidenceBand(value:number){return value>=.85?"HIGH" as const:value>=.6?"MEDIUM" as const:"LOW" as const;}
export function normalizeMeasurement(raw:string){
 let value=raw.trim().replace(/—/g,"x").replace(/(\d|mm|cm|m|")\s*[xX]\s*(?=\d)/gi,"$1 x ").replace(/(\d)\s+(mm|cm|m|V|A|W|kW|CV|HP|K|L|ml|kg|g)\b/gi,"$1$2").replace(/\s*\/\s*/g,"/");
 value=value.replace(/\bpol\.?/gi,'"').replace(/(\d)\s*"/g,'$1"');
 if(/(?:mm|cm|m) x (?:\d+ )?\d+\/\d+$/i.test(value))value+='"';
 value=value.replace(/(mm|cm|kw|cv|hp|ml|kg|k)\b/gi,match=>unitMap[match.toLowerCase()]??match);
 return value;
}
export function detectUnit(value:string){const match=value.match(/\d\s*(kW|CV|HP|mm|cm|ml|kg|V|A|W|K|L|m|g|")(?=$|\s|x)/);return match?.[1]??null;}
export function extractMeasurements(text:string){return [...text.matchAll(measurementPattern)].map(match=>({raw:match[0],normalized:normalizeMeasurement(match[0])}));}
